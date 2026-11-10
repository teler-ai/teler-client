import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Encryption } from '../../src/main/credential-store'
import type { FetchLike } from '../../src/main/device-login'
import { createPairingCode, LinkError, revokeLinkDevice } from '../../src/main/link-api'
import { LinkPairingStore, pairWithSidecar } from '../../src/main/link-pairing'
import { parseLinkPairAction } from '../../src/main/link-target'
import { linkSidecarEnvironment } from '../../src/main/sidecar'
import type { CliResult } from '../../src/main/sync-cli'

const ORIGIN = 'https://app.teler.example'
const ORG = 'org_01h455vb4pex5vsknk084sn02q'
const DEVICE = 'lnkdev_01h455vb4pex5vsknk084sn02s'
const SECRET = `tlk_${'a'.repeat(43)}`

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function recordingFetch(response: () => Response) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return response()
  }
  return { fetch, calls }
}

async function problem(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(LinkError)
  return (error as LinkError).problem
}

describe('the link-pair desktop action', () => {
  const action = (query: string) => `teler-desktop://link-pair?${query}`

  it('reads the organization to pair with', () => {
    expect(parseLinkPairAction(action(`organizationId=${ORG}`))).toEqual({ organizationId: ORG })
  })

  it('refuses other actions and missing or malformed organizations', () => {
    expect(parseLinkPairAction('teler-desktop://link-pair')).toBeNull()
    expect(parseLinkPairAction(action('organizationId=acme'))).toBeNull()
    expect(parseLinkPairAction(`teler-desktop://sync-folder?organizationId=${ORG}`)).toBeNull()
    expect(parseLinkPairAction(`https://link-pair/?organizationId=${ORG}`)).toBeNull()
    expect(parseLinkPairAction('not a url')).toBeNull()
  })
})

describe('Teler Link requests with the window session', () => {
  it('makes a pairing code that runs the chats on this computer', async () => {
    const { fetch, calls } = recordingFetch(() =>
      json(200, { success: true, data: { code: 'AB12C-DE34F', expiresAt: '2026-11-09T10:00:00Z' } })
    )
    expect(await createPairingCode(ORIGIN, ORG, fetch)).toBe('AB12C-DE34F')
    expect(calls[0]!.url).toBe(`${ORIGIN}/api/link/pairing-codes`)
    expect(calls[0]!.init?.method).toBe('POST')
    expect(calls[0]!.init?.redirect).toBe('manual')
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      organizationId: ORG,
      useForChatTurns: true,
    })
  })

  it('tells why Teler refused the code', async () => {
    const refused = (response: Response) =>
      problem(createPairingCode(ORIGIN, ORG, async () => response))
    expect(await refused(json(409, { code: 'LINK_DISABLED' }))).toBe('link-off')
    expect(await refused(json(409, { code: 'LINK_RESTRICTED' }))).toBe('link-restricted')
    expect(await refused(json(403, { code: 'FORBIDDEN' }))).toBe('not-member')
    expect(await refused(json(401, {}))).toBe('signed-out')
    expect(await refused(new Response(null, { status: 302 }))).toBe('signed-out')
    expect(await refused(json(503, {}))).toBe('network')
    // A code that could be read as an option never reaches the sidecar.
    expect(await refused(json(200, { success: true, data: { code: '--help' } }))).toBe('failed')
    expect(
      await problem(
        createPairingCode(ORIGIN, ORG, async () => {
          throw new TypeError('offline')
        })
      )
    ).toBe('network')
  })

  it('removes this computer, and one already gone counts as removed', async () => {
    const { fetch, calls } = recordingFetch(() => json(200, { success: true }))
    await revokeLinkDevice(ORIGIN, { deviceId: DEVICE, organizationId: ORG }, fetch)
    expect(calls[0]!.url).toBe(`${ORIGIN}/api/link/devices/${DEVICE}?organizationId=${ORG}`)
    expect(calls[0]!.init?.method).toBe('DELETE')
    await revokeLinkDevice(ORIGIN, { deviceId: DEVICE, organizationId: ORG }, async () =>
      json(404, {})
    )
    expect(
      await problem(
        revokeLinkDevice(ORIGIN, { deviceId: DEVICE, organizationId: ORG }, async () =>
          json(401, {})
        )
      )
    ).toBe('signed-out')
  })
})

describe('pairing through the sidecar', () => {
  function runner(result: Partial<CliResult>) {
    const runs: Array<{ args: readonly string[]; timeoutMs: number | undefined }> = []
    return {
      runs,
      runner: {
        async run(args: readonly string[], options?: { timeoutMs?: number }) {
          runs.push({ args, timeoutMs: options?.timeoutMs })
          return { exitCode: 0, stdout: '', stderr: '', ...result }
        },
      },
    }
  }
  const engines = [{ engine: 'claude_code', account: 'default', signedIn: true, version: '2.1.0' }]
  const output = { paired: true, deviceId: DEVICE, organizationId: ORG, secret: SECRET, engines }

  it('runs `teler link pair --json` and reads the pairing from stdout', async () => {
    const { runner: cli, runs } = runner({ stdout: `${JSON.stringify(output)}\n` })
    expect(await pairWithSidecar(cli, 'AB12C-DE34F', 'studio-mac')).toEqual({
      deviceId: DEVICE,
      organizationId: ORG,
      secret: SECRET,
      engines: [{ engine: 'claude_code', signedIn: true }],
    })
    expect(runs[0]!.args).toEqual(['link', 'pair', 'AB12C-DE34F', '--name', 'studio-mac', '--json'])
  })

  it('maps refusals and never puts the output in the error', async () => {
    const failed = async (result: Partial<CliResult>) => {
      const promise = pairWithSidecar(runner(result).runner, 'AB12C-DE34F', 'mac')
      const error = await promise.catch((caught: unknown) => caught)
      expect(String((error as Error).message)).not.toContain(SECRET)
      return problem(promise)
    }
    const refusal = (code: string, status: number) =>
      JSON.stringify({ error: { code, message: 'x', status } })
    expect(await failed({ exitCode: 1, stderr: refusal('LINK_DISABLED', 409) })).toBe('link-off')
    expect(await failed({ exitCode: 1, stderr: refusal('LINK_RESTRICTED', 409) })).toBe(
      'link-restricted'
    )
    expect(await failed({ exitCode: 1, stderr: refusal('CLIENT_UPDATE_REQUIRED', 426) })).toBe(
      'update-required'
    )
    expect(await failed({ exitCode: 1, stderr: refusal('PAIRING_CODE_INVALID', 400) })).toBe(
      'failed'
    )
    expect(await failed({ exitCode: 1, stderr: '', timedOut: true })).toBe('network')
    // A sidecar without managed mode prints no secret.
    const { secret: _secret, ...unmanaged } = output
    expect(await failed({ stdout: JSON.stringify(unmanaged) })).toBe('failed')
    expect(
      await failed({ stdout: JSON.stringify({ ...output, secret: `${SECRET} --leak` }) })
    ).toBe('failed')
  })
})

describe('the stored Link pairing', () => {
  const directories: string[] = []
  afterEach(async () => {
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true, force: true })
  })
  const encryption: Encryption = {
    isAvailable: () => true,
    encrypt: (plain) => Buffer.from(plain).reverse(),
    decrypt: (cipher) => Buffer.from(cipher).reverse().toString(),
  }
  const pairing = {
    origin: ORIGIN,
    userId: 'user_1',
    deviceId: DEVICE,
    organizationId: ORG,
    secret: SECRET,
  }

  it('persists only encrypted and bound to its origin', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'teler-desktop-link-'))
    directories.push(directory)
    const path = join(directory, 'link-pairing.bin')
    await new LinkPairingStore(path, encryption).write(pairing)
    expect((await readFile(path)).toString()).not.toContain(SECRET)
    expect(await new LinkPairingStore(path, encryption).read(ORIGIN)).toEqual(pairing)
    expect(await new LinkPairingStore(path, encryption).read('https://other.example')).toBeNull()
    const store = new LinkPairingStore(path, encryption)
    await store.clear()
    expect(await store.read(ORIGIN)).toBeNull()
  })

  it('keeps the pairing in memory only without OS encryption', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'teler-desktop-link-'))
    directories.push(directory)
    const path = join(directory, 'link-pairing.bin')
    const plain = { ...encryption, isAvailable: () => false }
    const store = new LinkPairingStore(path, plain)
    await store.write(pairing)
    expect(await store.read(ORIGIN)).toEqual(pairing)
    expect(await readFile(path).catch(() => null)).toBeNull()
  })
})

describe('the Link helper environment', () => {
  const base = {
    PATH: ['/usr/bin', '/bin'].join(delimiter),
    HOME: '/home/ana',
    XDG_CONFIG_HOME: '/home/ana/.config',
    TELER_TOKEN: 'developer-shell-token',
    TELER_URL: 'https://evil.example',
    TELER_LINK_PAIRING: '{"secret":"from-the-shell"}',
    TELER_LINK_CLAUDE_BIN: '/tmp/fake-claude',
    NODE_OPTIONS: '--inspect',
  }

  it('drops inherited TELER_* values and carries the pairing only in its own variable', () => {
    const env = linkSidecarEnvironment({
      base,
      origin: ORIGIN,
      dataDir: '/data/link',
      home: '/home/ana',
      platform: 'linux',
      pairing: { deviceId: DEVICE, organizationId: ORG, secret: SECRET },
    })
    expect(env.TELER_URL).toBe(ORIGIN)
    expect(env.TELER_LINK_MANAGED).toBe('1')
    expect(JSON.parse(env.TELER_LINK_PAIRING!)).toEqual({
      deviceId: DEVICE,
      secret: SECRET,
      organizationId: ORG,
    })
    expect(env.TELER_TOKEN).toBeUndefined()
    expect(env.TELER_LINK_CLAUDE_BIN).toBeUndefined()
    expect(env.TELER_SYNC_DAEMON).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
    const leaked = Object.entries(env).filter(
      ([key, value]) => key !== 'TELER_LINK_PAIRING' && value?.includes(SECRET)
    )
    expect(leaked).toEqual([])
    // The engines' own sign-ins live in the person's configuration directory.
    expect(env.XDG_CONFIG_HOME).toBe('/home/ana/.config')
    expect(env.XDG_STATE_HOME).toBe(join('/data/link', 'state'))
    // An app opened from the Dock still finds engines installed for the person.
    expect(env.PATH!.split(delimiter)).toEqual(
      expect.arrayContaining(['/usr/bin', '/bin', join('/home/ana', '.local', 'bin')])
    )
  })

  it('has no pairing while pairing and no configuration override without one', () => {
    const env = linkSidecarEnvironment({
      base: { PATH: '/usr/bin' },
      origin: ORIGIN,
      dataDir: '/data/link',
      home: '/home/ana',
      platform: 'win32',
      pairing: null,
    })
    expect(env.TELER_LINK_PAIRING).toBeUndefined()
    expect(env.TELER_LINK_MANAGED).toBe('1')
    expect(env.XDG_CONFIG_HOME).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
  })
})
