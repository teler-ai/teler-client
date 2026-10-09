import type { StoredCredential } from '../../src/main/credential-store'
import { DeviceLoginError, type DeviceAuthorization } from '../../src/main/device-login'
import type { SyncCliError, SyncStatus } from '../../src/main/sync-cli'
import { SyncController, type SyncCommands } from '../../src/main/sync-controller'

// Fakes for every SyncController dependency; each side effect is recorded in `log`.

export const origin = 'https://app.teler.ai'
type StatusRegistration = SyncStatus['registrations'][number]

export function registration(overrides: Partial<StatusRegistration> = {}): StatusRegistration {
  return {
    id: 'reg_1',
    localPath: '/home/ana/Reports',
    origin,
    accountId: 'user_1',
    organizationId: 'org_1',
    destination: '/personal/Reports',
    paused: false,
    status: 'ready',
    checkedAt: 1,
    files: [],
    ...overrides,
  }
}

interface HarnessOptions {
  credential?: StoredCredential
  syncPaused?: boolean
  registerError?: SyncCliError
  /** Approving the device code with the window session fails. */
  approveError?: DeviceLoginError
  /** Teler limits upload starts until then. */
  throttledUntil?: number | null
}

export function harness(options: HarnessOptions = {}) {
  const log: string[] = []
  let registrations: StatusRegistration[] = []
  let issue: (token: string) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const settings = { value: { syncPaused: options.syncPaused ?? false } }
  const projectNames = new Map<string, string>()
  let stored = options.credential ?? null
  let environment: () => NodeJS.ProcessEnv = () => ({})
  let now = 0
  let statusReads = 0
  // A held status read returns the registrations as they were when it started.
  let statusGate: Promise<void> | null = null
  let releaseStatus: () => void = () => undefined
  const setPaused = (id: string, paused: boolean) =>
    (registrations = registrations.map((item) =>
      item.id === id ? { ...item, paused, status: paused ? 'paused' : 'pending' } : item
    ))
  const cli: SyncCommands = {
    async status() {
      statusReads++
      const snapshot = registrations
      if (statusGate) await statusGate
      return {
        daemonRunning: true,
        throttledUntil: options.throttledUntil ?? null,
        registrations: snapshot,
      }
    },
    async preview(input) {
      log.push(`preview ${input.localPath}`)
      return {
        localPath: input.localPath,
        destination: input.destination,
        files: [{ relativePath: 'a.csv', bytes: 10 }],
        skipped: [{ relativePath: '.env', reason: 'excluded' }],
      }
    },
    async register(input) {
      if (options.registerError) throw options.registerError
      const target = [input.organizationId, input.projectId].filter(Boolean).join(' ')
      log.push(`register ${input.localPath} ${input.destination}${target ? ` ${target}` : ''}`)
      const created = registration({ id: 'reg_new', ...input, status: 'pending' })
      registrations = [...registrations, created]
      return created
    },
    async pause(id) {
      log.push(`pause ${id}`)
      setPaused(id, true)
    },
    async resume(id) {
      log.push(`resume ${id}`)
      setPaused(id, false)
    },
    async retry(id) {
      log.push(`retry ${id}`)
    },
    async remove(id) {
      log.push(`remove ${id}`)
      registrations = registrations.filter((item) => item.id !== id)
    },
  }
  const authorization: DeviceAuthorization = {
    userCode: 'ABCD2345',
    expiresAt: 600_000,
    token: () =>
      new Promise((resolve, rejectToken) => {
        issue = resolve
        reject = rejectToken
      }),
  }
  const controller = new SyncController({
    origin,
    createCli: (provider) => {
      environment = provider
      return cli
    },
    environment: (token) => ({ TELER_TOKEN: token ?? undefined }),
    supervisor: {
      start: async (env) => void log.push(`start ${env.TELER_TOKEN}`),
      stop: async () => void log.push('stop'),
      restart: async (env) => {
        log.push(`restart ${env.TELER_TOKEN}`)
        if (env.TELER_TOKEN === 'unstartable') throw new Error('spawn failed')
      },
      shutdown: async () => void log.push('shutdown'),
    },
    credentials: {
      read: async (requested) => (stored?.origin === requested ? stored : null),
      write: async (credential) => {
        if (credential.token === 'unwritable') throw new Error('disk full')
        stored = credential
      },
      clear: async () => void (stored = null),
    },
    projectNames: {
      get: (id) => projectNames.get(id) ?? null,
      set: async (id, name) => void projectNames.set(id, name),
      delete: async (id) => void projectNames.delete(id),
    },
    settings: {
      value: settings.value,
      update: async (patch) => Object.assign(settings.value, patch),
    },
    login: {
      start: async () => authorization,
      approve: async (userCode) => {
        log.push(`approve ${userCode}`)
        if (options.approveError) throw options.approveError
      },
      account: async (token) => {
        if (token === 'refused') throw new DeviceLoginError('not-eligible')
        return {
          user: { id: 'user_1', name: token === 'no-org' ? null : 'Ana' },
          activeOrganizationId: token === 'no-org' ? null : 'org_1',
        }
      },
      revoke: async (token) => void log.push(`revoke ${token}`),
    },
    realpath: async (path) => {
      if (path.includes('missing')) throw new Error('ENOENT')
      return path.replace(/\/$/, '')
    },
    onSignInRequired: () => void log.push('notify'),
    now: () => now,
  })
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  return {
    controller,
    log,
    flush,
    advance: (milliseconds: number) => (now += milliseconds),
    statusReads: () => statusReads,
    holdStatus: () => (statusGate = new Promise((resolve) => (releaseStatus = resolve))),
    releaseStatus: () => {
      statusGate = null
      releaseStatus()
    },
    cliToken: () => environment().TELER_TOKEN,
    /** The device grant issues a token after the approval. */
    issue: (token: string) => issue(token),
    reject: (error: unknown) => reject(error),
    stored: () => stored,
    projectName: (id: string) => projectNames.get(id) ?? null,
    setRegistrations: (next: StatusRegistration[]) => (registrations = next),
  }
}

export const credential = { origin, token: 'old-token', account: { id: 'user_1', name: 'Ana' } }
