import { hostname, platform } from 'node:os'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { FetchLike } from '../api'
import { assertNoFlags, takeOption } from '../command-args'
import type { CredentialStore } from '../credentials'
import { UsageError } from '../errors'
import { resolveTelerUrl, type TelerUrlEnv } from '../url'
import { runAccountCommand } from './account-command'
import { accountEnvironment, readAccounts } from './accounts'
import { LinkApi } from './api'
import { detectEngines, type EngineCommands } from './engines'
import { LinkUnpairedError, runLinkHelper } from './helper'
import type { LinkEngineInfo } from './protocol'
import type { ServiceHost } from './service'
import { runServiceCommand, systemServiceHost } from './service-command'
import { deletePairing, isManaged, managedPairing, readPairing, writePairing } from './store'

export const LINK_USAGE =
  'Usage: teler link pair <code> [--name <name>] | teler link [start] | teler link status | teler link unpair | teler link account list|add|remove | teler link service install|uninstall|status'

interface LinkOutput {
  json: boolean
  write: (text: string) => void
}

interface LinkDeps {
  env: NodeJS.ProcessEnv & TelerUrlEnv
  store: CredentialStore
  fetch?: FetchLike
  commands?: EngineCommands
  serviceHost?: ServiceHost
}

/** The engines run Link turns from this empty folder, the same one every turn. */
function workDirectory(env: NodeJS.ProcessEnv): string {
  const state = env.XDG_STATE_HOME?.trim() || join(homedir(), '.local', 'state')
  return join(state, 'teler', 'link', 'work')
}

const ENGINE_NAMES = { claude_code: 'Claude Code', codex: 'Codex' } as const

const KEEP_RUNNING =
  'Keep it running in the background with `teler link service install`, or run `teler link` in a terminal.\n'

function engineLine(engine: LinkEngineInfo): string {
  const details = [engine.plan, engine.identity].filter(Boolean).join(', ')
  const state = engine.signedIn ? `signed in${details ? ` (${details})` : ''}` : 'signed out'
  const login =
    engine.account === 'default' ? 'default login' : `account ${engine.account} (${engine.label})`
  return `${ENGINE_NAMES[engine.engine]} ${engine.version}, ${login}: ${state}\n`
}

/**
 * `teler link`: run your Teler chats on your own Claude Code or Codex plan. Pair this computer
 * with a code from Teler (Agent controls › Teler Link), then keep `teler link` running; Teler
 * sends each chat turn here, the engine answers it with your own sign-in, and Teler's tools still
 * run in Teler. In managed mode (`TELER_LINK_MANAGED=1`) an application such as Teler Desktop
 * keeps the pairing and passes it in `TELER_LINK_PAIRING`.
 */
export async function runLinkCommand(
  action: string | undefined,
  args: string[],
  output: LinkOutput,
  deps: LinkDeps
): Promise<number> {
  const { env } = deps
  const baseUrl = resolveTelerUrl(env)
  const api = new LinkApi(baseUrl, deps.fetch)
  const managed = isManaged(env)
  const accounts = () => readAccounts(env).catch(() => [])
  const engines = async () => detectEngines(deps.commands, env, await accounts())
  const currentPairing = () =>
    managed ? Promise.resolve(managedPairing(env)) : readPairing(deps.store, baseUrl.origin)

  if (action === 'account') {
    const [subaction, ...rest] = args
    return await runAccountCommand(subaction, rest, output, {
      env,
      ...(deps.commands ? { commands: deps.commands } : {}),
    })
  }
  if (action === 'service') {
    const [subaction, ...rest] = args
    return await runServiceCommand(subaction, rest, output, {
      host: deps.serviceHost ?? systemServiceHost(env),
      managed,
      paired: async () => Boolean(await currentPairing()),
    })
  }
  if (action === 'pair') {
    const name = takeOption(args, '--name') ?? hostname()
    assertNoFlags(args)
    const [code] = args
    if (!code || args.length !== 1) throw new UsageError(LINK_USAGE)
    // A supervisor keeps the secret itself, so it has to come back on stdout.
    if (managed && !output.json)
      throw new UsageError('With TELER_LINK_MANAGED=1, `teler link pair` needs --json.')
    const found = await engines()
    const pairing = await api.pair({
      code,
      name: name.slice(0, 80),
      platform: platform(),
      engines: found,
    })
    if (!managed) await writePairing(deps.store, baseUrl.origin, pairing)
    if (output.json) {
      output.write(
        `${JSON.stringify({
          paired: true,
          deviceId: pairing.deviceId,
          organizationId: pairing.organizationId,
          ...(managed ? { secret: pairing.secret } : {}),
          engines: found,
        })}\n`
      )
      return 0
    }
    const signedIn = [
      ...new Set(found.filter((e) => e.signedIn).map((e) => ENGINE_NAMES[e.engine])),
    ]
    output.write(`Paired this computer with ${baseUrl.origin}.\n`)
    output.write(
      signedIn.length > 0
        ? `Signed in here: ${signedIn.join(', ')}. Choose which one runs your chats in Teler: Agent controls › Teler Link.\n`
        : 'Neither Claude Code nor Codex is signed in here: install one and sign in (`claude auth login` or `codex login`).\n'
    )
    output.write(KEEP_RUNNING)
    return 0
  }
  if (action === 'status') {
    assertNoFlags(args)
    const pairing = await currentPairing()
    const found = await engines()
    if (output.json) {
      output.write(
        `${JSON.stringify({ paired: Boolean(pairing), deviceId: pairing?.deviceId ?? null, engines: found })}\n`
      )
      return 0
    }
    output.write(
      pairing ? `Paired with ${baseUrl.origin}.\n` : 'Not paired. Run `teler link pair <code>`.\n'
    )
    for (const engine of found) output.write(engineLine(engine))
    if (found.length === 0)
      output.write('Neither Claude Code nor Codex was found on this computer.\n')
    return 0
  }
  if (action === 'unpair') {
    assertNoFlags(args)
    // In managed mode the supervisor holds the pairing; there is nothing stored here.
    if (!managed) await deletePairing(deps.store, baseUrl.origin)
    output.write(
      output.json
        ? `${JSON.stringify({ paired: false })}\n`
        : 'Forgot the pairing on this computer. Remove it in Teler too: Agent controls › Teler Link.\n'
    )
    return 0
  }
  if (action !== undefined && action !== 'start') throw new UsageError(LINK_USAGE)
  assertNoFlags(args)
  if (args.length > 0) throw new UsageError(LINK_USAGE)
  const pairing = await currentPairing()
  if (!pairing)
    throw new UsageError(
      managed
        ? 'TELER_LINK_PAIRING is missing or not valid.'
        : 'Not paired. Make a code in Teler (Agent controls › Teler Link), then run `teler link pair <code>`.'
    )
  const controller = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => controller.abort())
  const log = (line: string) => {
    if (!output.json) output.write(`${line}\n`)
  }
  log(`Teler Link is running for ${baseUrl.origin}. Press Ctrl+C to stop.`)
  try {
    await runLinkHelper(
      {
        api,
        secret: pairing.secret,
        workDir: workDirectory(env),
        detectEngines: engines,
        accountEnv: async (engine, account) =>
          accountEnvironment(engine, account, await accounts(), env),
        log,
        env,
      },
      controller.signal
    )
  } catch (error) {
    if (error instanceof LinkUnpairedError) {
      throw new UsageError(
        'Teler no longer accepts this computer. Make a new code in Teler (Agent controls › Teler Link) and pair again.'
      )
    }
    throw error
  }
  return 0
}
