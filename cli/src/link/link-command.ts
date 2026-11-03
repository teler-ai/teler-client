import { hostname, platform } from 'node:os'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { FetchLike } from '../api'
import { assertNoFlags, takeOption } from '../command-args'
import type { CredentialStore } from '../credentials'
import { UsageError } from '../errors'
import { resolveTelerUrl, type TelerUrlEnv } from '../url'
import { LinkApi } from './api'
import { detectEngines } from './engines'
import { LinkUnpairedError, runLinkHelper } from './helper'
import { deletePairing, readPairing, writePairing } from './store'

export const LINK_USAGE =
  'Usage: teler link pair <code> [--name <name>] | teler link [start] | teler link status | teler link unpair'

interface LinkOutput {
  json: boolean
  write: (text: string) => void
}

interface LinkDeps {
  env: NodeJS.ProcessEnv & TelerUrlEnv
  store: CredentialStore
  fetch?: FetchLike
}

/** Claude Code runs Link turns from this empty folder, the same one every turn. */
function workDirectory(env: NodeJS.ProcessEnv): string {
  const state = env.XDG_STATE_HOME?.trim() || join(homedir(), '.local', 'state')
  return join(state, 'teler', 'link', 'work')
}

const ENGINE_NAMES = { claude_code: 'Claude Code', codex: 'Codex' } as const

/**
 * `teler link`: run your Teler chats on your own Claude Code plan. Pair this computer with a
 * code from Teler (Agent controls › Teler Link), then keep `teler link` running; Teler sends each chat
 * turn here, Claude Code answers it with your own sign-in, and Teler's tools still run in Teler.
 */
export async function runLinkCommand(
  action: string | undefined,
  args: string[],
  output: LinkOutput,
  deps: LinkDeps
): Promise<number> {
  const baseUrl = resolveTelerUrl(deps.env)
  const api = new LinkApi(baseUrl, deps.fetch)
  if (action === 'pair') {
    const name = takeOption(args, '--name') ?? hostname()
    assertNoFlags(args)
    const [code] = args
    if (!code || args.length !== 1) throw new UsageError(LINK_USAGE)
    const engines = await detectEngines(undefined, deps.env)
    const pairing = await api.pair({ code, name: name.slice(0, 80), platform: platform(), engines })
    await writePairing(deps.store, baseUrl.origin, pairing)
    const claude = engines.find((engine) => engine.engine === 'claude_code')
    if (output.json) {
      output.write(`${JSON.stringify({ paired: true, deviceId: pairing.deviceId, engines })}\n`)
    } else {
      output.write(`Paired this computer with ${baseUrl.origin}.\n`)
      output.write(
        claude?.signedIn
          ? 'Claude Code is signed in. Run `teler link` and keep it running to answer your chats.\n'
          : 'Claude Code was not found or is not signed in: install it and run `claude auth login`, then `teler link`.\n'
      )
    }
    return 0
  }
  if (action === 'status') {
    assertNoFlags(args)
    const pairing = await readPairing(deps.store, baseUrl.origin)
    const engines = await detectEngines(undefined, deps.env)
    if (output.json) {
      output.write(
        `${JSON.stringify({ paired: Boolean(pairing), deviceId: pairing?.deviceId ?? null, engines })}\n`
      )
    } else {
      output.write(
        pairing ? `Paired with ${baseUrl.origin}.\n` : 'Not paired. Run `teler link pair <code>`.\n'
      )
      for (const engine of engines) {
        output.write(
          `${ENGINE_NAMES[engine.engine]} ${engine.version}: ${engine.signedIn ? `signed in${engine.plan ? ` (${engine.plan})` : ''}` : 'signed out'}\n`
        )
      }
      if (engines.length === 0) output.write('Claude Code was not found on this computer.\n')
    }
    return 0
  }
  if (action === 'unpair') {
    assertNoFlags(args)
    await deletePairing(deps.store, baseUrl.origin)
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
  const pairing = await readPairing(deps.store, baseUrl.origin)
  if (!pairing)
    throw new UsageError(
      'Not paired. Make a code in Teler (Agent controls › Teler Link), then run `teler link pair <code>`.'
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
        workDir: workDirectory(deps.env),
        detectEngines: () => detectEngines(undefined, deps.env),
        log,
        env: deps.env,
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
