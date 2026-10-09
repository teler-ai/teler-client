import type { ConnectionState, SyncHealth, SyncedFolder } from '../shared/desktop-api'
import type { StoredCredential } from './credential-store'
import type { DeviceAuthorization, SyncAccountDetails } from './device-login'
import type { SyncCli } from './sync-cli'

export type SyncCommands = Pick<
  SyncCli,
  'status' | 'preview' | 'register' | 'pause' | 'resume' | 'retry' | 'remove'
>

/** Everything the sync controller touches, injected so it runs without Electron. */
export interface SyncControllerDeps {
  origin: string
  createCli(environment: () => NodeJS.ProcessEnv): SyncCommands
  environment(token: string | null): NodeJS.ProcessEnv
  supervisor: {
    start(env: NodeJS.ProcessEnv): Promise<void>
    stop(): Promise<void>
    restart(env: NodeJS.ProcessEnv): Promise<void>
    /** Stops for good when the app quits. */
    shutdown(): Promise<void>
  }
  credentials: {
    read(origin: string): Promise<StoredCredential | null>
    write(credential: StoredCredential): Promise<void>
    clear(): Promise<void>
  }
  /** Names of the projects folders were added into, kept for display. */
  projectNames: {
    get(registrationId: string): string | null
    set(registrationId: string, name: string): Promise<void>
    delete(registrationId: string): Promise<void>
  }
  settings: {
    value: { syncPaused: boolean }
    update(patch: { syncPaused: boolean }): Promise<unknown>
  }
  login: {
    start(): Promise<DeviceAuthorization>
    /** Approves the device code with the session of the Teler window. */
    approve(userCode: string): Promise<void>
    account(token: string): Promise<SyncAccountDetails>
    revoke(token: string): Promise<void>
  }
  realpath(path: string): Promise<string>
  onSignInRequired(): void
  now(): number
}

export interface SyncSnapshot {
  connection: ConnectionState
  folders: SyncedFolder[]
  /** Teler limits upload starts until then (epoch ms). */
  throttledUntil: number | null
  syncPaused: boolean
  health: SyncHealth
}
