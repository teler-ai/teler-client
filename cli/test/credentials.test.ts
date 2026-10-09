import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createConfiguredCredentialStore,
  createCredentialStore,
  createFileCredentialStore,
} from '../src/credentials'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('OS credential storage', () => {
  it('uses native macOS Keychain access without spawning a command', async () => {
    const values = new Map<string, string>()
    const store = createCredentialStore(
      'darwin',
      () => {
        throw new Error('macOS credential storage must not spawn a command')
      },
      async () => ({
        get: async (resource) => values.get(resource) ?? null,
        set: async (resource, token) => void values.set(resource, token),
        delete: async (resource) => void values.delete(resource),
      })
    )

    await store.set('https://app.teler.ai', 'token-secret')
    expect(await store.get('https://app.teler.ai')).toBe('token-secret')
    await store.delete('https://app.teler.ai')
    expect(await store.get('https://app.teler.ai')).toBeNull()
  })

  it('sends Linux tokens over stdin', async () => {
    const calls: Array<{ command: string[]; stdin?: Uint8Array }> = []
    const store = createCredentialStore('linux', (command, stdin) => {
      calls.push({ command, stdin })
      return { exitCode: 0, stdout: new Uint8Array() }
    })

    await store.set('https://app.teler.ai', 'token-secret')

    expect(calls[0]?.command).not.toContain('token-secret')
    expect(new TextDecoder().decode(calls[0]?.stdin)).toBe('token-secret')
  })

  it('persists opt-in headless credentials in a private file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'teler-cli-credentials-'))
    temporaryDirectories.push(directory)
    const credentialDirectory = join(directory, 'nested')
    const store = createFileCredentialStore(credentialDirectory)

    await store.set('https://app.teler.ai', 'token-secret')

    expect(await store.get('https://app.teler.ai')).toBe('token-secret')
    expect((await stat(credentialDirectory)).mode & 0o777).toBe(0o700)
    const [credentialFile] = await readdir(credentialDirectory)
    expect(credentialFile).toMatch(/^[a-f0-9]{64}\.json$/)
    const path = join(credentialDirectory, credentialFile!)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      resource: 'https://app.teler.ai',
      token: 'token-secret',
    })

    await store.delete('https://app.teler.ai')
    expect(await store.get('https://app.teler.ai')).toBeNull()
  })

  it('selects the file store explicitly for headless hosts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'teler-cli-config-'))
    temporaryDirectories.push(directory)
    const store = createConfiguredCredentialStore({
      TELER_CREDENTIAL_STORE: 'file',
      XDG_CONFIG_HOME: directory,
    })

    await store.set('https://app.teler.ai', 'token-secret')

    expect(await store.get('https://app.teler.ai')).toBe('token-secret')
    expect(await stat(join(directory, 'teler', 'credentials'))).toBeDefined()
  })

  it('isolates concurrent updates for different origins', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'teler-cli-concurrent-'))
    temporaryDirectories.push(directory)
    const store = createFileCredentialStore(join(directory, 'credentials'))

    await Promise.all([
      store.set('https://one.teler.example', 'token-one'),
      store.set('https://two.teler.example', 'token-two'),
    ])
    await store.delete('https://one.teler.example')

    expect(await store.get('https://one.teler.example')).toBeNull()
    expect(await store.get('https://two.teler.example')).toBe('token-two')
  })
})
