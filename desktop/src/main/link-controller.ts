import type { SupervisorState } from './daemon-supervisor'
import { LinkError, type LinkProblem } from './link-api'
import type { LinkEngineReport, LinkPairResult, StoredLinkPairing } from './link-pairing'
import type { SessionUser } from './window-session'

/** The engines Teler Link can answer chats with. */
export type LinkEngine = 'claude_code' | 'codex'

/** What the tray shows: null while this computer is not paired. */
export interface LinkState {
  status: SupervisorState
}

export type LinkPairOutcome =
  /**
   * Paired, and the helper runs. `engine` answers the chats; without one, `signedOutEngine` is
   * installed but needs a sign-in, and with neither no engine was found.
   */
  | { kind: 'paired'; engine: LinkEngine | null; signedOutEngine: LinkEngine | null }
  /** This computer already runs the account's chats for that organization. */
  | { kind: 'already-running' }
  /** Another request is still pairing. */
  | { kind: 'busy' }
  | { kind: 'failed'; problem: LinkProblem }

/** Everything the Link controller touches, injected so it runs without Electron. */
export interface LinkControllerDeps {
  origin: string
  /** This computer's name in Teler. */
  hostname(): string
  /** The account signed in to the Teler window; `undefined` when unknown right now. */
  readSession(): Promise<SessionUser | undefined>
  /** `POST /api/link/pairing-codes` with the window session. */
  createCode(organizationId: string): Promise<string>
  /** `DELETE /api/link/devices/:id` with the window session. */
  revoke(device: { deviceId: string; organizationId: string }): Promise<void>
  /** `teler link pair <code> --name <name> --json` in managed mode. */
  pair(code: string, name: string): Promise<LinkPairResult>
  store: {
    read(origin: string): Promise<StoredLinkPairing | null>
    write(pairing: StoredLinkPairing): Promise<void>
    clear(): Promise<void>
  }
  /** The helper's environment, with the pairing. */
  environment(pairing: StoredLinkPairing): NodeJS.ProcessEnv
  supervisor: {
    readonly state: SupervisorState
    start(env: NodeJS.ProcessEnv): Promise<void>
    stop(): Promise<void>
    shutdown(): Promise<void>
  }
}

const ENGINE_ORDER: readonly LinkEngine[] = ['claude_code', 'codex']

function firstEngine(engines: LinkEngineReport[], signedIn: boolean): LinkEngine | null {
  return (
    ENGINE_ORDER.find((engine) =>
      engines.some((report) => report.engine === engine && report.signedIn === signedIn)
    ) ?? null
  )
}

/** The computer to remove, without its secret. */
function deviceOf(pairing: { deviceId: string; organizationId: string }) {
  return { deviceId: pairing.deviceId, organizationId: pairing.organizationId }
}

/**
 * Teler Link in Teler Desktop: "Run my chats on this computer" pairs this computer with the
 * window's session, and the app then runs `teler link` while that account is signed in to the
 * window. One pairing per origin: pairing for another organization replaces it.
 *
 * Operations run one at a time, in call order.
 */
export class LinkController {
  private pairing: StoredLinkPairing | null = null
  /** Whether the window's account owns the pairing; unknown until the session is first read. */
  private allowed = true
  private pairingNow = false
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly deps: LinkControllerDeps) {}

  get state(): LinkState | null {
    return this.pairing ? { status: this.deps.supervisor.state } : null
  }

  /** The paired computer's id while the window's account owns the pairing; never the secret. */
  get deviceId(): string | null {
    return this.pairing && this.allowed ? this.pairing.deviceId : null
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Reads the stored pairing and runs the helper if the window's account owns it. */
  init(): Promise<void> {
    return this.serialize(async () => {
      this.pairing = await this.deps.store.read(this.deps.origin)
      this.changed()
      await this.followNow()
    })
  }

  /** Follows the window's session: the helper runs only for the account that paired. */
  check(): Promise<void> {
    return this.serialize(() => this.followNow())
  }

  /** "Run my chats on this computer" from a Teler page. */
  async pair(organizationId: string): Promise<LinkPairOutcome> {
    if (this.pairingNow) return { kind: 'busy' }
    this.pairingNow = true
    try {
      return await this.serialize(() => this.pairNow(organizationId))
    } finally {
      this.pairingNow = false
    }
  }

  /**
   * "Stop running my chats here": stops the helper, removes this computer from Teler and forgets
   * the pairing. Resolves false when Teler could not be told, so the person removes it there.
   */
  stop(): Promise<boolean> {
    return this.serialize(async () => {
      const pairing = this.pairing
      if (!pairing) return true
      await this.deps.supervisor.stop()
      // Another account in the window would not find this computer in Teler: never ask it to.
      const user = await this.deps.readSession().catch(() => undefined)
      const removed =
        user && user.id !== pairing.userId
          ? false
          : await this.deps.revoke(deviceOf(pairing)).then(
              () => true,
              () => false
            )
      await this.forget()
      return removed
    })
  }

  /** The helper exited because Teler no longer accepts this computer (removed in Teler). */
  revoked(): Promise<void> {
    return this.serialize(() => this.forget())
  }

  supervisorChanged(): void {
    this.changed()
  }

  /** Stops the helper for good when the app quits; the pairing stays for the next launch. */
  shutdown(): Promise<void> {
    return this.deps.supervisor.shutdown()
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async followNow(): Promise<void> {
    const pairing = this.pairing
    if (!pairing) return
    const user = await this.deps.readSession()
    // Unknown (offline, or a proxy answered): keep the last decision.
    const allowed = user === undefined ? this.allowed : user !== null && user.id === pairing.userId
    // Which account the window shows decides whether its pages see this computer as theirs.
    if (allowed !== this.allowed) {
      this.allowed = allowed
      this.changed()
    }
    if (this.allowed) await this.deps.supervisor.start(this.deps.environment(pairing))
    else await this.deps.supervisor.stop()
  }

  private async pairNow(organizationId: string): Promise<LinkPairOutcome> {
    const user = await this.deps.readSession()
    if (user === null) return { kind: 'failed', problem: 'signed-out' }
    if (user === undefined) return { kind: 'failed', problem: 'network' }
    const current = this.pairing
    if (current && current.organizationId === organizationId && current.userId === user.id) {
      this.allowed = true
      await this.deps.supervisor.start(this.deps.environment(current))
      return { kind: 'already-running' }
    }
    let result: LinkPairResult
    try {
      const code = await this.deps.createCode(organizationId)
      result = await this.deps.pair(code, this.deps.hostname().slice(0, 80))
    } catch (error) {
      return { kind: 'failed', problem: error instanceof LinkError ? error.problem : 'failed' }
    }
    if (result.organizationId !== organizationId) {
      await this.deps.revoke(deviceOf(result)).catch(() => undefined)
      return { kind: 'failed', problem: 'failed' }
    }
    if (current) {
      // One pairing per origin: the earlier computer entry goes, in Teler too.
      await this.deps.supervisor.stop()
      await this.deps.revoke(deviceOf(current)).catch(() => undefined)
    }
    const next: StoredLinkPairing = {
      origin: this.deps.origin,
      userId: user.id,
      deviceId: result.deviceId,
      organizationId: result.organizationId,
      secret: result.secret,
    }
    // Without a keyring (or on a write error) the pairing still lives in memory until quit.
    await this.deps.store.write(next).catch(() => undefined)
    this.pairing = next
    this.allowed = true
    this.changed()
    await this.deps.supervisor.start(this.deps.environment(next))
    const engine = firstEngine(result.engines, true)
    return {
      kind: 'paired',
      engine,
      signedOutEngine: engine ? null : firstEngine(result.engines, false),
    }
  }

  private async forget(): Promise<void> {
    this.pairing = null
    await this.deps.store.clear().catch(() => undefined)
    this.changed()
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}
