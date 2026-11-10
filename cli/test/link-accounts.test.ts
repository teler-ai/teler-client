import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  accountEnvironment,
  accountsFile,
  addAccount,
  MAX_EXTRA_ACCOUNTS,
  readAccounts,
  removeAccount,
} from '../src/link/accounts'
import { detectEngines, parseCodexStatus, type EngineCommands } from '../src/link/engines'
import { runLinkHelper } from '../src/link/helper'
import type { LinkEngineInfo, LinkFrame, LinkUpFrame } from '../src/link/protocol'
import { runLinkCommand } from '../src/link/link-command'
import type { CredentialStore } from '../src/credentials'

let root: string
let env: NodeJS.ProcessEnv

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'teler-link-accounts-'))
  env = { XDG_CONFIG_HOME: join(root, 'config'), TELER_URL: 'https://app.teler.example' }
  await mkdir(join(root, 'claude-work'))
  await mkdir(join(root, 'codex-second'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Claude Code and Codex, each answering per config folder, as their own CLIs would. */
function fakeEngines(seen: Array<{ command: string[]; dir?: string }> = []): EngineCommands {
  return {
    async run(command, _timeout, runEnv) {
      const [binary, first] = command
      const dir = binary === 'claude' ? runEnv?.CLAUDE_CONFIG_DIR : runEnv?.CODEX_HOME
      seen.push({ command, ...(dir ? { dir } : {}) })
      if (first === '--version')
        return binary === 'claude'
          ? { exitCode: 0, stdout: '2.1.319 (Claude Code)\n', stderr: '' }
          : { exitCode: 0, stdout: 'codex-cli 0.167.0\n', stderr: '' }
      if (binary === 'claude')
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            dir
              ? { loggedIn: true, subscriptionType: 'max', email: 'work@example.com' }
              : { loggedIn: true, subscriptionType: 'pro', email: 'me@example.com' }
          ),
          stderr: '',
        }
      return dir
        ? { exitCode: 1, stdout: '', stderr: 'Not logged in\n' }
        : { exitCode: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' }
    },
  }
}

describe('teler link: engine accounts', () => {
  test('adds, lists and removes extra logins in a private file', async () => {
    const added = await addAccount(env, {
      engine: 'claude_code',
      configDir: join(root, 'claude-work'),
      label: 'Work',
    })
    expect(added).toEqual({
      engine: 'claude_code',
      id: 'claude-work',
      label: 'Work',
      configDir: join(root, 'claude-work'),
    })
    expect((await stat(accountsFile(env))).mode & 0o777).toBe(0o600)
    await addAccount(env, { engine: 'codex', configDir: join(root, 'codex-second'), id: 'second' })
    expect((await readAccounts(env)).map((account) => account.id)).toEqual([
      'claude-work',
      'second',
    ])
    await expect(
      addAccount(env, { engine: 'codex', configDir: join(root, 'claude-work'), id: 'second' })
    ).rejects.toThrow('already exists')
    await expect(
      addAccount(env, { engine: 'codex', configDir: join(root, 'claude-work'), id: 'default' })
    ).rejects.toThrow('not "default"')
    await expect(
      addAccount(env, { engine: 'codex', configDir: join(root, 'missing') })
    ).rejects.toThrow('is not a folder')
    await expect(
      addAccount(env, { engine: 'gemini', configDir: join(root, 'claude-work') })
    ).rejects.toThrow('claude_code or codex')
    expect(await removeAccount(env, 'second')).toBe(true)
    expect(await removeAccount(env, 'second')).toBe(false)
    expect((await readAccounts(env)).map((account) => account.id)).toEqual(['claude-work'])
  })

  test('stops at the number of logins Teler accepts from one computer', async () => {
    for (let n = 1; n <= MAX_EXTRA_ACCOUNTS; n++) {
      await mkdir(join(root, `claude-${n}`))
      await addAccount(env, { engine: 'claude_code', configDir: join(root, `claude-${n}`) })
    }
    await mkdir(join(root, 'claude-one-more'))
    await expect(
      addAccount(env, { engine: 'claude_code', configDir: join(root, 'claude-one-more') })
    ).rejects.toThrow(`at most ${MAX_EXTRA_ACCOUNTS}`)
    // The other engine still has room, and both together fit in one report to Teler (16).
    await addAccount(env, { engine: 'codex', configDir: join(root, 'codex-second') })
    expect(2 * (1 + MAX_EXTRA_ACCOUNTS)).toBeLessThanOrEqual(16)
  })

  test('runs an engine with the config folder of the login it was asked for', async () => {
    const accounts = [
      { engine: 'codex' as const, id: 'second', label: 'Second', configDir: '/c/second' },
    ]
    expect(accountEnvironment('codex', 'default', accounts, { HOME: '/h' })).toEqual({ HOME: '/h' })
    expect(accountEnvironment('codex', 'second', accounts, { HOME: '/h' })).toEqual({
      HOME: '/h',
      CODEX_HOME: '/c/second',
    })
    expect(accountEnvironment('claude_code', 'second', accounts, {})).toBeNull()
    expect(accountEnvironment('codex', 'unknown', accounts, {})).toBeNull()
  })

  test('detects every login of each engine through the engine itself', async () => {
    const seen: Array<{ command: string[]; dir?: string }> = []
    const engines = await detectEngines(fakeEngines(seen), {}, [
      { engine: 'claude_code', id: 'work', label: 'Work', configDir: '/c/work' },
      { engine: 'codex', id: 'second', label: 'Second', configDir: '/c/second' },
    ])
    expect(engines).toEqual([
      {
        engine: 'claude_code',
        account: 'default',
        label: 'Default',
        version: '2.1.319',
        signedIn: true,
        plan: 'pro',
        identity: 'me@example.com',
      },
      {
        engine: 'claude_code',
        account: 'work',
        label: 'Work',
        version: '2.1.319',
        signedIn: true,
        plan: 'max',
        identity: 'work@example.com',
      },
      {
        engine: 'codex',
        account: 'default',
        label: 'Default',
        version: '0.167.0',
        signedIn: true,
        plan: 'chatgpt',
      },
      { engine: 'codex', account: 'second', label: 'Second', version: '0.167.0', signedIn: false },
    ])
    expect(
      seen.filter((call) => call.dir).map((call) => [call.command.join(' '), call.dir])
    ).toEqual([
      ['claude auth status', '/c/work'],
      ['codex login status', '/c/second'],
    ])
    expect(
      parseCodexStatus({ exitCode: 0, stdout: 'Logged in using an API key - sk-***\n', stderr: '' })
    ).toEqual({
      signedIn: true,
      plan: 'api_key',
    })
  })
})

describe('teler link: choosing the login for a turn', () => {
  const taskId = 'atask_01m6g8vpeye9wsphes2mht0r0b'
  const engines: LinkEngineInfo[] = [
    {
      engine: 'claude_code',
      account: 'default',
      label: 'Default',
      version: '2.1.319',
      signedIn: true,
    },
    { engine: 'claude_code', account: 'work', label: 'Work', version: '2.1.319', signedIn: false },
  ]

  async function refusal(engine: string, account: string) {
    const posted: Array<{ taskId: string; seq: number } & LinkUpFrame> = []
    let polled = false
    const turnStart: LinkFrame = {
      taskId,
      seq: 0,
      kind: 'turn.start',
      payload: {
        protocol: 1,
        engine,
        account,
        model: 'sonnet',
        instructions: '',
        history: [],
        input: [{ type: 'text', text: 'hi' }],
        tools: [],
      },
    }
    const stop = new AbortController()
    const done = runLinkHelper(
      {
        api: {
          async poll(_secret, input) {
            if (!polled) {
              polled = true
              return {
                frames: [turnStart],
                nextUpSeq: {},
                chatTurnEngine: null,
                chatTurnAccount: null,
              }
            }
            await new Promise((resolve) => input.signal?.addEventListener('abort', resolve))
            throw new Error('stopped')
          },
          async postFrames(_secret, frames) {
            posted.push(...frames)
          },
        },
        secret: 'tlk_x',
        workDir: join(root, 'work'),
        detectEngines: async () => engines,
        log: () => undefined,
      },
      stop.signal
    )
    for (let attempt = 0; attempt < 50 && posted.length === 0; attempt++) await Bun.sleep(10)
    stop.abort()
    await done
    return posted.map((frame) => frame.payload)
  }

  test('refuses a signed-out or unknown login, and an engine this computer lacks', async () => {
    expect(await refusal('claude_code', 'work')).toEqual([
      { status: 'failed', error: 'engine_signed_out' },
    ])
    expect(await refusal('claude_code', 'nobody')).toEqual([
      { status: 'failed', error: 'engine_signed_out' },
    ])
    expect(await refusal('codex', 'default')).toEqual([
      { status: 'failed', error: 'engine_missing' },
    ])
  })
})

describe('teler link: managed pairing', () => {
  const pairing = {
    deviceId: 'lnkdev_01m6g8vpeye9wsphes2mht0r0b',
    secret: `tlk_${'a'.repeat(43)}`,
    organizationId: 'org_example',
  }
  function deps(extra: NodeJS.ProcessEnv) {
    const stored: string[] = []
    const store: CredentialStore = {
      get: async () => null,
      set: async (resource) => void stored.push(resource),
      delete: async () => undefined,
    }
    return {
      stored,
      deps: {
        env: { ...env, ...extra },
        store,
        commands: fakeEngines(),
        fetch: async () => Response.json({ success: true, data: pairing }),
      },
    }
  }

  test('prints the secret only to a supervisor, and never stores it', async () => {
    const managed = deps({ TELER_LINK_MANAGED: '1' })
    let out = ''
    await runLinkCommand(
      'pair',
      ['ABCD-1234', '--name', 'Desk'],
      { json: true, write: (t) => void (out += t) },
      managed.deps
    )
    expect(JSON.parse(out)).toMatchObject({ paired: true, ...pairing })
    expect(managed.stored).toEqual([])
    await expect(
      runLinkCommand('pair', ['ABCD-1234'], { json: false, write: () => undefined }, managed.deps)
    ).rejects.toThrow('needs --json')
  })

  test('stores the secret otherwise, keeps it out of the output and hints at the service', async () => {
    const plain = deps({})
    let out = ''
    await runLinkCommand(
      'pair',
      ['ABCD-1234'],
      { json: false, write: (t) => void (out += t) },
      plain.deps
    )
    expect(plain.stored).toEqual(['https://app.teler.example#link'])
    expect(out).not.toContain(pairing.secret)
    expect(out.trim().split('\n').at(-1)).toContain('teler link service install')
    let json = ''
    await runLinkCommand(
      'pair',
      ['ABCD-1234'],
      { json: true, write: (t) => void (json += t) },
      plain.deps
    )
    expect(json).not.toContain(pairing.secret)
  })

  test('reads the pairing from TELER_LINK_PAIRING in managed mode', async () => {
    const managed = deps({ TELER_LINK_MANAGED: '1', TELER_LINK_PAIRING: JSON.stringify(pairing) })
    let out = ''
    await runLinkCommand('status', [], { json: true, write: (t) => void (out += t) }, managed.deps)
    const status = JSON.parse(out) as { paired: boolean; deviceId: string; engines: unknown[] }
    expect(status.paired).toBe(true)
    expect(status.deviceId).toBe(pairing.deviceId)
    expect(status.engines).toHaveLength(2)
    expect(out).not.toContain(pairing.secret)
    const broken = deps({ TELER_LINK_MANAGED: '1', TELER_LINK_PAIRING: '{"secret":"x"}' })
    await expect(
      runLinkCommand(undefined, [], { json: true, write: () => undefined }, broken.deps)
    ).rejects.toThrow('TELER_LINK_PAIRING')
  })
})
