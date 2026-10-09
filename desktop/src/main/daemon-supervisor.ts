export interface DaemonExit {
  code: number | null
}

export interface DaemonHandle {
  exited: Promise<DaemonExit>
  kill(): void
}

export interface SupervisorDeps {
  spawn(env: NodeJS.ProcessEnv): DaemonHandle
  /** `teler sync stop`: asks the lease owner to stop and waits for its acknowledgement. */
  requestStop(env: NodeJS.ProcessEnv): Promise<void>
  wait(milliseconds: number): Promise<void>
  now(): number
}

export type SupervisorState = 'stopped' | 'running' | 'restarting'

const BASE_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 60_000
const STABLE_RUN_MS = 60_000
const STOP_TIMEOUT_MS = 15_000

/**
 * Runs `teler sync daemon` while the app is running. A crashed daemon restarts
 * with exponential backoff. A daemon that exits cleanly without being asked to
 * stop found the sync lease held by another process, typically a daemon
 * orphaned by a previous app crash; it is asked to stop and then replaced.
 *
 * Start, stop and restart run one at a time, in call order, so a stop that is
 * still waiting for the daemon can never swallow a later start. After
 * `shutdown()` nothing starts again.
 */
export class DaemonSupervisor {
  private current: DaemonHandle | null = null
  private env: NodeJS.ProcessEnv | null = null
  private generation = 0
  private failures = 0
  private status: SupervisorState = 'stopped'
  private queue: Promise<void> = Promise.resolve()
  private closed = false

  constructor(
    private readonly deps: SupervisorDeps,
    private readonly onChange: (state: SupervisorState) => void = () => undefined
  ) {}

  get state(): SupervisorState {
    return this.status
  }

  start(env: NodeJS.ProcessEnv): Promise<void> {
    return this.serialize(async () => this.startNow(env))
  }

  stop(): Promise<void> {
    return this.serialize(() => this.stopNow())
  }

  /** Restarts with a new environment, for example after reconnecting sync. */
  restart(env: NodeJS.ProcessEnv): Promise<void> {
    return this.serialize(async () => {
      await this.stopNow()
      this.startNow(env)
    })
  }

  /**
   * Relaunches a daemon that is running, so its launch picks up fresh values
   * such as a renewed Access token. Does nothing while stopped.
   */
  relaunch(): Promise<void> {
    return this.serialize(async () => {
      const env = this.env
      if (this.status === 'stopped' || !env) return
      await this.stopNow()
      this.startNow(env)
    })
  }

  /** Stops for good: later start and restart calls are ignored. */
  shutdown(): Promise<void> {
    this.closed = true
    return this.serialize(() => this.stopNow())
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => undefined)
    return result
  }

  private startNow(env: NodeJS.ProcessEnv): void {
    if (this.closed) return
    this.env = env
    if (this.status !== 'stopped') return
    this.failures = 0
    this.launch(++this.generation)
  }

  private async stopNow(): Promise<void> {
    this.generation++
    const handle = this.current
    const env = this.env
    this.current = null
    if (handle && env) {
      await this.deps.requestStop(env).catch(() => undefined)
      const exited = await Promise.race([
        handle.exited.then(() => true),
        this.deps.wait(STOP_TIMEOUT_MS).then(() => false),
      ])
      if (!exited) handle.kill()
    }
    this.setState('stopped')
  }

  private launch(generation: number): void {
    const env = this.env
    if (!env) return
    const startedAt = this.deps.now()
    const handle = this.deps.spawn(env)
    this.current = handle
    this.setState('running')
    void handle.exited.then(async (exit) => {
      if (generation !== this.generation) return
      this.current = null
      if (this.deps.now() - startedAt >= STABLE_RUN_MS) this.failures = 0
      if (exit.code === 0) {
        await this.deps.requestStop(env).catch(() => undefined)
        // A stop or restart that ran meanwhile owns the state now.
        if (generation !== this.generation) return
      }
      const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.failures)
      this.failures++
      this.setState('restarting')
      await this.deps.wait(delay)
      if (generation === this.generation && !this.closed) this.launch(generation)
    })
  }

  private setState(state: SupervisorState) {
    if (state === this.status) return
    this.status = state
    this.onChange(state)
  }
}
