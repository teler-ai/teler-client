import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialStore, type Encryption } from '../../src/main/credential-store'
import { resolveSidecar, sidecarEnvironment, withSidecarAccess } from '../../src/main/sidecar'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function file() {
  const directory = await mkdtemp(join(tmpdir(), 'teler-desktop-credentials-'))
  directories.push(directory)
  return join(directory, 'nested', 'sync-credential.bin')
}

// Reversible stand-in for safeStorage: proves no plaintext reaches the disk.
const encryption: Encryption = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(plain).reverse(),
  decrypt: (cipher) => Buffer.from(cipher).reverse().toString(),
}
const credential = {
  origin: 'https://app.teler.ai',
  token: 'secret-token',
  account: { id: 'user_1', name: 'Ana' },
}

describe('credential store', () => {
  it('persists only encrypted, private credentials bound to their origin', async () => {
    const path = await file()
    await new CredentialStore(path, encryption).write(credential)
    expect((await readFile(path)).toString()).not.toContain('secret-token')
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o077).toBe(0)

    const reopened = new CredentialStore(path, encryption)
    expect(await reopened.read('https://app.teler.example')).toBeNull()
    expect(await reopened.read(credential.origin)).toEqual(credential)
  })

  it('keeps credentials in memory only without a keyring', async () => {
    const path = await file()
    const unavailable = { ...encryption, isAvailable: () => false }
    const store = new CredentialStore(path, unavailable)
    expect(store.persistence).toBe('session')
    await store.write(credential)
    expect(await store.read(credential.origin)).toEqual(credential)
    await expect(stat(path)).rejects.toThrow()
    expect(await new CredentialStore(path, unavailable).read(credential.origin)).toBeNull()
  })

  it('treats corrupt files as disconnected and clears them', async () => {
    const path = await file()
    const store = new CredentialStore(path, encryption)
    await store.write(credential)
    await writeFile(path, 'garbage')
    expect(await new CredentialStore(path, encryption).read(credential.origin)).toBeNull()
    await store.clear()
    expect(await store.read(credential.origin)).toBeNull()
    await expect(stat(path)).rejects.toThrow()
  })
})

describe('sidecar', () => {
  it('runs the packaged binary, the CLI package in development, or an override', async () => {
    const base = { resourcesPath: '/App/Resources', appPath: '/repo/desktop', env: {} }
    expect(resolveSidecar({ ...base, isPackaged: true, platform: 'darwin' })).toEqual({
      command: join('/App/Resources', 'sidecar', 'teler'),
      args: [],
    })
    expect(resolveSidecar({ ...base, isPackaged: true, platform: 'win32' }).command).toMatch(
      /teler\.exe$/
    )
    // Development runs the `teler` entry of the app's `@teler-ai/cli` dependency.
    const appPath = fileURLToPath(new URL('../..', import.meta.url))
    const cliPackage = createRequire(join(appPath, 'package.json')).resolve(
      '@teler-ai/cli/package.json'
    )
    const { bin } = JSON.parse(await readFile(cliPackage, 'utf8')) as { bin: { teler: string } }
    expect(
      resolveSidecar({
        ...base,
        appPath,
        isPackaged: false,
        platform: 'linux',
        env: { BUN_EXECUTABLE: '/b' },
      })
    ).toEqual({ command: '/b', args: [join(dirname(cliPackage), bin.teler)] })
    expect(
      resolveSidecar({
        ...base,
        isPackaged: true,
        platform: 'linux',
        env: { TELER_DESKTOP_SIDECAR: '/tmp/teler' },
      })
    ).toEqual({ command: '/tmp/teler', args: [] })
  })

  it('isolates the CLI environment and supplies the app token only when connected', () => {
    const env = sidecarEnvironment({
      base: {
        PATH: '/usr/bin',
        TELER_TOKEN: 'developer-shell-token',
        TELER_URL: 'https://evil.example',
        ELECTRON_RUN_AS_NODE: '1',
        NODE_OPTIONS: '--inspect',
      },
      origin: 'https://app.teler.ai',
      dataDir: '/data',
      token: null,
    })
    expect(env).toEqual({
      PATH: '/usr/bin',
      TELER_URL: 'https://app.teler.ai',
      TELER_SYNC_DAEMON: 'managed',
      TELER_NO_UPDATE_CHECK: '1',
      TELER_CREDENTIAL_STORE: 'file',
      XDG_STATE_HOME: join('/data', 'state'),
      XDG_CONFIG_HOME: join('/data', 'config'),
    })
    expect(
      sidecarEnvironment({ base: {}, origin: 'https://app.teler.ai', dataDir: '/d', token: 't' })
        .TELER_TOKEN
    ).toBe('t')
  })

  it('gives each launch the current Cloudflare Access token, or none', () => {
    const env = { TELER_URL: 'https://app.teler.example', TELER_ACCESS_TOKEN: 'stale' }
    expect(withSidecarAccess(env, 'renewed').TELER_ACCESS_TOKEN).toBe('renewed')
    expect(withSidecarAccess(env, null)).toEqual({ TELER_URL: 'https://app.teler.example' })
    expect(env.TELER_ACCESS_TOKEN).toBe('stale')
  })
})
