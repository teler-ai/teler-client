import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { net, safeStorage } from 'electron'
import { AccessToken, withAccessHeader, type CookieJar } from './access-token'
import { createCliRunner, spawnSyncDaemon } from './cli-process'
import { CredentialStore, type Encryption } from './credential-store'
import { DaemonSupervisor } from './daemon-supervisor'
import {
  fetchSyncAccount,
  revokeSyncToken,
  startDeviceAuthorization,
  type DeviceLoginDeps,
  type FetchLike,
} from './device-login'
import { SettingsStore } from './preferences'
import { sidecarEnvironment, withSidecarAccess, type SidecarCommand } from './sidecar'
import { SyncCli } from './sync-cli'
import { SyncController } from './sync-controller'
import { SyncSession } from './sync-session'
import { approveWithWindowSession, readWindowSession } from './window-session'

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true }
    )
  })
}

/**
 * OS-backed encryption: Keychain, DPAPI, or the Secret Service/KWallet. Linux
 * without a keyring falls back to a fixed key, which is not treated as
 * encryption, so the credential then stays in memory only.
 */
export const electronEncryption: Encryption = {
  isAvailable: () =>
    safeStorage.isEncryptionAvailable() &&
    !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
  encrypt: (plainText) => safeStorage.encryptString(plainText),
  decrypt: (cipherText) => safeStorage.decryptString(cipherText),
}

export interface SyncServicesOptions {
  origin: string
  /** Where sign-in and the account API live; normally the app origin. */
  authOrigin: string
  userData: string
  sidecar: SidecarCommand
  /** The Teler window session's cookies, for the Cloudflare Access token. */
  cookies: CookieJar
  /** Requests with the Teler window session's cookies. */
  windowFetch: FetchLike
  onSignInRequired(): void
}

export function createSyncServices(options: SyncServicesOptions) {
  const { origin, sidecar } = options
  const dataDir = join(options.userData, 'sync')
  const environment = (token: string | null) =>
    sidecarEnvironment({ base: process.env, origin, dataDir, token })
  const credentials = new CredentialStore(
    join(options.userData, 'sync-credential.bin'),
    electronEncryption
  )
  const settings = new SettingsStore(join(options.userData, 'settings.json'))
  const access = new AccessToken(origin, options.cookies)
  // Every CLI launch gets the Access token current at that moment.
  const launch = (env: NodeJS.ProcessEnv) => withSidecarAccess(env, access.current)
  // Chromium's network stack honours the system proxy configuration.
  const loginDeps: DeviceLoginDeps = {
    fetch: (input, init) => net.fetch(input, withAccessHeader(init, input, origin, access.current)),
    wait,
    now: Date.now,
  }
  let controller: SyncController | null = null
  const supervisor = new DaemonSupervisor(
    {
      spawn: (env) => spawnSyncDaemon(sidecar, launch(env)),
      requestStop: (env) => new SyncCli(createCliRunner(sidecar, () => launch(env))).stop(),
      wait: (milliseconds) => wait(milliseconds),
      now: Date.now,
    },
    (state) => controller?.supervisorChanged(state)
  )
  controller = new SyncController({
    origin,
    createCli: (env) => new SyncCli(createCliRunner(sidecar, () => launch(env()))),
    environment,
    supervisor,
    credentials,
    settings,
    login: {
      start: () => startDeviceAuthorization(origin, loginDeps),
      approve: (userCode) =>
        approveWithWindowSession(options.authOrigin, userCode, options.windowFetch),
      account: (token) => fetchSyncAccount(origin, token, loginDeps),
      revoke: (token) => revokeSyncToken(origin, token, loginDeps),
    },
    projectNames: {
      get: (id) => settings.value.folderProjects[id] ?? null,
      set: async (id, name) => {
        await settings.update({ folderProjects: { ...settings.value.folderProjects, [id]: name } })
      },
      delete: async (id) => {
        const { [id]: _removed, ...rest } = settings.value.folderProjects
        await settings.update({ folderProjects: rest })
      },
    },
    realpath: (path) => realpath(path),
    onSignInRequired: options.onSignInRequired,
    now: Date.now,
  })
  const session = new SyncSession({
    controller,
    settings,
    readSession: () => readWindowSession(options.authOrigin, options.windowFetch),
  })
  return {
    controller,
    session,
    credentials,
    settings,
    /** Reads the Access token, relaunching sync whenever the window renews it. */
    watchAccess: () => access.watch(() => void supervisor.relaunch()),
  }
}
