import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { UsageError } from './errors'

const SERVICE = 'ai.teler.cli'

export interface CredentialStore {
  get(resource: string): Promise<string | null>
  set(resource: string, token: string): Promise<void>
  delete(resource: string): Promise<void>
}

type RunResult = { exitCode: number; stdout: Uint8Array }
type RunCommand = (command: string[], stdin?: Uint8Array) => RunResult
type LoadMacOSStore = () => Promise<CredentialStore>

const runCommand: RunCommand = (command, stdin) =>
  Bun.spawnSync(command, { stdin, stdout: 'pipe', stderr: 'ignore' })

const loadMacOSStore: LoadMacOSStore = async () => {
  const { createMacOSKeychainStore } = await import('./macos-keychain')
  return createMacOSKeychainStore(SERVICE)
}

function commandError(): UsageError {
  return new UsageError(
    'No supported OS credential store is available; use TELER_CREDENTIAL_STORE=file on a trusted headless host'
  )
}

function fileCredentialDirectory(env: NodeJS.ProcessEnv): string {
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim()
  return join(xdgConfigHome || join(homedir(), '.config'), 'teler', 'credentials')
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function resourceCredentialPath(directory: string, resource: string): string {
  const digest = createHash('sha256').update(resource).digest('hex')
  return join(directory, `${digest}.json`)
}

async function readFileCredential(path: string, resource: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Reflect.get(raw, 'resource') !== resource ||
      typeof Reflect.get(raw, 'token') !== 'string'
    ) {
      throw new UsageError('Teler CLI credential file is invalid')
    }
    return Reflect.get(raw, 'token') as string
  } catch (error) {
    if (isMissingFile(error)) return null
    if (error instanceof UsageError) throw error
    throw new UsageError('Teler CLI credential file could not be read')
  }
}

async function writeFileCredential(
  path: string,
  directory: string,
  resource: string,
  token: string
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify({ resource, token })}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await rename(temporaryPath, path)
    await chmod(path, 0o600)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

/** Explicit file-backed storage for headless hosts without a Secret Service session. */
export function createFileCredentialStore(
  directory = fileCredentialDirectory(process.env)
): CredentialStore {
  return {
    async get(resource) {
      return readFileCredential(resourceCredentialPath(directory, resource), resource)
    },
    async set(resource, token) {
      const path = resourceCredentialPath(directory, resource)
      await writeFileCredential(path, directory, resource, token)
    },
    async delete(resource) {
      await unlink(resourceCredentialPath(directory, resource)).catch((error: unknown) => {
        if (!isMissingFile(error)) throw error
      })
    },
  }
}

export function createCredentialStore(
  platform: NodeJS.Platform = process.platform,
  run: RunCommand = runCommand,
  loadNativeMacOSStore: LoadMacOSStore = loadMacOSStore
): CredentialStore {
  if (platform === 'darwin') {
    let nativeStore: Promise<CredentialStore> | undefined
    const getNativeStore = () => (nativeStore ??= loadNativeMacOSStore())
    return {
      async get(resource) {
        return (await getNativeStore()).get(resource)
      },
      async set(resource, token) {
        await (await getNativeStore()).set(resource, token)
      },
      async delete(resource) {
        await (await getNativeStore()).delete(resource)
      },
    }
  }
  if (platform === 'linux') {
    return {
      async get(resource) {
        const result = run(['secret-tool', 'lookup', 'service', SERVICE, 'resource', resource])
        return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim() || null : null
      },
      async set(resource, token) {
        const result = run(
          [
            'secret-tool',
            'store',
            `--label=Teler CLI (${resource})`,
            'service',
            SERVICE,
            'resource',
            resource,
          ],
          new TextEncoder().encode(token)
        )
        if (result.exitCode !== 0) throw commandError()
      },
      async delete(resource) {
        run(['secret-tool', 'clear', 'service', SERVICE, 'resource', resource])
      },
    }
  }
  throw commandError()
}

export function createConfiguredCredentialStore(
  env: NodeJS.ProcessEnv = process.env
): CredentialStore {
  const mode = env.TELER_CREDENTIAL_STORE?.trim() || 'os'
  if (mode === 'os') return createCredentialStore()
  if (mode === 'file') return createFileCredentialStore(fileCredentialDirectory(env))
  throw new UsageError('TELER_CREDENTIAL_STORE must be os or file')
}

export interface ResolvedCredential {
  source: 'environment' | 'store'
  token: string
}

/**
 * A store factory is only invoked without an environment token, so hosts with
 * no supported OS credential store (Windows) can still use `TELER_TOKEN`.
 */
export async function resolveCredential(
  store: CredentialStore | (() => CredentialStore),
  resource: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ResolvedCredential | null> {
  const override = env.TELER_TOKEN?.trim()
  if (override) return { source: 'environment', token: override }
  const stored = await (typeof store === 'function' ? store() : store).get(resource)
  return stored ? { source: 'store', token: stored } : null
}
