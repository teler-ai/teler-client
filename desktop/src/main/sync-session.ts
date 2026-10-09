import type { ConnectionState, DesktopResult } from '../shared/desktop-api'
import type { SessionUser } from './window-session'

export type { SessionUser } from './window-session'

export interface SyncSessionDeps {
  controller: {
    readonly state: { connection: ConnectionState }
    connect(): Promise<DesktopResult<null>>
    /** Stops sync, revoking its token and keeping the folders. */
    disconnect(): Promise<void>
    /** Resolves once no connection is in progress. */
    settled(): Promise<void>
  }
  settings: {
    value: { autoConnect: boolean }
    update(patch: { autoConnect: boolean }): Promise<unknown>
  }
  /** The account signed in to the Teler window; `undefined` when unknown right now. */
  readSession(): Promise<SessionUser | undefined>
}

/**
 * Keeps folder sync on the account signed in to the Teler window. Signing out
 * disconnects sync; signing in reconnects it if the user has connected before
 * and has not disconnected since (`autoConnect`); another account takes over.
 */
export class SyncSession {
  private checking: Promise<void> | null = null
  private recheck = false

  constructor(private readonly deps: SyncSessionDeps) {}

  /** Follows the current session, adopting connections made before sync followed it. */
  async start(): Promise<void> {
    const { controller, settings } = this.deps
    if (controller.state.connection.status === 'connected' && !settings.value.autoConnect)
      await settings.update({ autoConnect: true })
    await this.check()
  }

  /** The user asked to connect; from now on sync follows their sign-ins. */
  async connect(): Promise<DesktopResult<null>> {
    await this.deps.settings.update({ autoConnect: true })
    return this.deps.controller.connect()
  }

  /** The user asked to disconnect; sync stays off until they connect again. */
  async disconnect(): Promise<void> {
    await this.deps.settings.update({ autoConnect: false })
    await this.deps.controller.disconnect()
  }

  /** Reads the session again; a change during a check is followed by another read. */
  check(): Promise<void> {
    this.recheck = true
    this.checking ??= this.drain().finally(() => (this.checking = null))
    return this.checking
  }

  private async drain(): Promise<void> {
    while (this.recheck) {
      this.recheck = false
      await this.follow()
    }
  }

  private async follow(): Promise<void> {
    const user = await this.deps.readSession()
    if (user === undefined) return
    const { controller, settings } = this.deps
    const { connection } = controller.state
    if (connection.status === 'connecting') {
      // The session may change while connecting: decide once it settles.
      await controller.settled()
      this.recheck = true
      return
    }
    const syncedAs = connection.status === 'connected' ? (connection.account?.id ?? null) : null
    if (syncedAs !== null && syncedAs === user?.id) return
    if (syncedAs !== null) await controller.disconnect()
    if (user && settings.value.autoConnect) await controller.connect()
  }
}
