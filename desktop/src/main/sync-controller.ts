import type {
  ConnectionState,
  DesktopErrorCode,
  DesktopResult,
  FolderInput,
  FolderPreview,
  SyncedFolder,
} from '../shared/desktop-api'
import type { SupervisorState } from './daemon-supervisor'
import { DeviceLoginError } from './device-login'
import { SyncCliError, type SyncStatus } from './sync-cli'
import type { SyncCommands, SyncControllerDeps, SyncSnapshot } from './sync-controller-deps'
import { resolveFolderInput, summarizeHealth, toFolderPreview, toSyncedFolder } from './sync-state'

export type { SyncCommands, SyncControllerDeps } from './sync-controller-deps'

const IDLE_POLL_MS = 60_000
const DISCONNECTED: ConnectionState = { status: 'disconnected', account: null, error: null }

function errorCode(error: unknown): DesktopErrorCode {
  return error instanceof SyncCliError || error instanceof DeviceLoginError
    ? error.code
    : 'sync-failed'
}

/** Owns the sync credential, the supervised daemon and the folder list. */
export class SyncController {
  private readonly cli: SyncCommands
  private token: string | null = null
  private connection: ConnectionState = DISCONNECTED
  private folders: SyncedFolder[] = []
  private throttledUntil: number | null = null
  private registrations: SyncStatus['registrations'] = []
  private daemonRestarting = false
  private login: AbortController | null = null
  private connecting: Promise<DesktopResult<null>> | null = null
  private signInNotified = false
  private refreshing: Promise<void> | null = null
  private loadedAt = 0
  private readonly listeners = new Set<() => void>()

  constructor(private readonly deps: SyncControllerDeps) {
    this.cli = deps.createCli(() => deps.environment(this.token))
  }

  get state(): SyncSnapshot {
    return {
      connection: this.connection,
      folders: this.folders,
      throttledUntil: this.throttledUntil,
      syncPaused: this.deps.settings.value.syncPaused,
      health: summarizeHealth({
        connected: this.token !== null,
        syncPaused: this.deps.settings.value.syncPaused,
        daemonRestarting: this.daemonRestarting,
        folders: this.folders,
      }),
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async init(): Promise<void> {
    const credential = await this.deps.credentials.read(this.deps.origin)
    if (credential) {
      this.token = credential.token
      this.connection = { status: 'connected', account: credential.account, error: null }
      if (!this.deps.settings.value.syncPaused)
        await this.deps.supervisor.start(this.deps.environment(this.token))
    }
    await this.refresh()
  }

  supervisorChanged(state: SupervisorState): void {
    this.daemonRestarting = state === 'restarting'
    this.emit()
  }

  refresh(): Promise<void> {
    this.refreshing ??= this.loadStatus().finally(() => (this.refreshing = null))
    return this.refreshing
  }

  /** The periodic refresh: every tick while connected, once a minute otherwise. */
  poll(): Promise<void> {
    if (this.token === null && this.deps.now() - this.loadedAt < IDLE_POLL_MS)
      return Promise.resolve()
    return this.refresh()
  }

  /**
   * Connects sync to the account signed in to the Teler window and resolves
   * when done. Simultaneous requests share one attempt.
   */
  connect(): Promise<DesktopResult<null>> {
    this.connecting ??= this.runConnection().finally(() => (this.connecting = null))
    return this.connecting
  }

  /** Resolves once no connection is in progress. */
  async settled(): Promise<void> {
    await this.connecting
  }

  async disconnect(): Promise<void> {
    // An interrupted connection revokes the token it may still receive.
    this.login?.abort()
    this.login = null
    this.settleConnection(null)
    const token = this.token
    this.token = null
    await this.deps.supervisor.stop()
    await this.deps.credentials.clear()
    if (token) await this.deps.login.revoke(token)
    this.settleConnection(null)
    await this.refresh()
  }

  preview(input: FolderInput): Promise<DesktopResult<FolderPreview>> {
    return this.withFolder(input, async (localPath) =>
      toFolderPreview(await this.cli.preview({ localPath, destination: input.destination }))
    )
  }

  async add(input: FolderInput): Promise<DesktopResult<SyncedFolder>> {
    if (!this.token) return { ok: false, error: 'not-connected' }
    return this.withFolder(input, async (localPath) => {
      const registration = await this.cli.register({ ...input, localPath })
      if (input.projectId && input.projectName)
        await this.deps.projectNames.set(registration.id, input.projectName)
      await this.reload()
      return (
        this.folders.find((folder) => folder.id === registration.id) ??
        toSyncedFolder({ ...registration, files: [] }, this.accountId(), input.projectName)
      )
    })
  }

  pause(id: string) {
    return this.withRegistration(id, (registration) => this.cli.pause(registration))
  }

  resume(id: string) {
    return this.withRegistration(id, (registration) => this.cli.resume(registration))
  }

  /** Tries the folder's waiting files now. */
  retry(id: string) {
    return this.withRegistration(id, (registration) => this.cli.retry(registration))
  }

  /** Stops tracking the folder; files already uploaded stay in Teler. */
  remove(id: string) {
    return this.withRegistration(id, async (registration) => {
      await this.cli.remove(registration)
      await this.deps.projectNames.delete(registration)
    })
  }

  /** The last `sync status` read, for this origin. */
  get status(): SyncStatus['registrations'] {
    return this.registrations
  }

  folderPath(id: string): string | null {
    return this.folders.find((folder) => folder.id === id)?.localPath ?? null
  }

  async setSyncPaused(paused: boolean): Promise<void> {
    await this.deps.settings.update({ syncPaused: paused })
    if (paused) await this.deps.supervisor.stop()
    else if (this.token) await this.deps.supervisor.start(this.deps.environment(this.token))
    this.emit()
  }

  async shutdown(): Promise<void> {
    this.login?.abort()
    await this.deps.supervisor.shutdown()
  }

  private async runConnection(): Promise<DesktopResult<null>> {
    const controller = new AbortController()
    this.login = controller
    this.connection = { ...this.connection, status: 'connecting', error: null }
    this.emit()
    let token: string | null = null
    try {
      const authorization = await this.deps.login.start()
      await this.deps.login.approve(authorization.userCode)
      controller.signal.throwIfAborted()
      token = await authorization.token(controller.signal)
      const account = await this.deps.login.account(token)
      controller.signal.throwIfAborted()
      if (!account.activeOrganizationId) throw new DeviceLoginError('no-organization')
      const previous = this.token
      const accountSummary = { id: account.user.id, name: account.user.name }
      await this.deps.credentials.write({
        origin: this.deps.origin,
        token,
        account: accountSummary,
      })
      this.token = token
      this.connection = { status: 'connected', account: accountSummary, error: null }
      if (previous && previous !== token) await this.deps.login.revoke(previous)
      if (!this.deps.settings.value.syncPaused)
        await this.deps.supervisor.restart(this.deps.environment(token))
      return { ok: true, value: null }
    } catch (error) {
      // A redeemed token the app doesn't keep must not stay valid.
      if (token && token !== this.token) await this.deps.login.revoke(token)
      if (!controller.signal.aborted) this.settleConnection(errorCode(error))
      return { ok: false, error: errorCode(error) }
    } finally {
      if (this.login === controller) this.login = null
      await this.refresh()
    }
  }

  /** Leaves the connecting state, keeping an existing connection. */
  private settleConnection(error: DesktopErrorCode | null) {
    this.connection = {
      status: this.token ? 'connected' : 'disconnected',
      account: this.token ? this.connection.account : null,
      error,
    }
    this.emit()
  }

  private async withFolder<T>(
    input: FolderInput,
    run: (localPath: string) => Promise<T>
  ): Promise<DesktopResult<T>> {
    const folder = await resolveFolderInput(input, this.folders, this.deps.realpath)
    if (!folder.ok) return folder
    try {
      return { ok: true, value: await run(folder.value) }
    } catch (error) {
      return { ok: false, error: errorCode(error) }
    }
  }

  private async withRegistration(
    id: string,
    run: (id: string) => Promise<void>
  ): Promise<DesktopResult<null>> {
    if (!this.folders.some((folder) => folder.id === id))
      return { ok: false, error: 'invalid-folder' }
    try {
      await run(id)
      await this.reload()
      return { ok: true, value: null }
    } catch (error) {
      return { ok: false, error: errorCode(error) }
    }
  }

  /** After a change: a status read that was already running may predate it. */
  private async reload(): Promise<void> {
    await this.refreshing
    await this.refresh()
  }

  private accountId(): string | null {
    return this.token ? (this.connection.account?.id ?? null) : null
  }

  private async loadStatus(): Promise<void> {
    try {
      const status = await this.cli.status()
      const accountId = this.accountId()
      const { projectNames } = this.deps
      this.throttledUntil = status.throttledUntil ?? null
      this.registrations = status.registrations.filter(
        (registration) => registration.origin === this.deps.origin
      )
      this.folders = this.registrations.map((registration) =>
        toSyncedFolder(registration, accountId, projectNames.get(registration.id))
      )
    } catch {
      // Keep the last known folders; the next poll retries.
    }
    this.loadedAt = this.deps.now()
    const signInRequired = this.state.health === 'sign-in-required'
    if (signInRequired && !this.signInNotified) this.deps.onSignInRequired()
    this.signInNotified = signInRequired
    this.emit()
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}
