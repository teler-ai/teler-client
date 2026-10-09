import { describe, expect, it } from 'vitest'
import {
  DaemonSupervisor,
  type DaemonExit,
  type DaemonHandle,
  type SupervisorState,
} from '../../src/main/daemon-supervisor'

interface FakeDaemon extends DaemonHandle {
  exit(code: number | null): void
  killed: boolean
}

function harness() {
  let now = 0
  const daemons: FakeDaemon[] = []
  const waits: Array<{ ms: number; resolve: () => void }> = []
  const stops: NodeJS.ProcessEnv[] = []
  const states: SupervisorState[] = []
  let requestStop: () => Promise<void> = async () => undefined
  const supervisor = new DaemonSupervisor(
    {
      spawn() {
        let exit!: (value: DaemonExit) => void
        const daemon: FakeDaemon = {
          exited: new Promise((resolve) => (exit = resolve)),
          exit: (code) => exit({ code }),
          killed: false,
          kill() {
            daemon.killed = true
            exit({ code: null })
          },
        }
        daemons.push(daemon)
        return daemon
      },
      async requestStop(env) {
        stops.push(env)
        await requestStop()
      },
      wait: (ms) => new Promise<void>((resolve) => waits.push({ ms, resolve })),
      now: () => now,
    },
    (state) => states.push(state)
  )
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  return {
    supervisor,
    daemons,
    waits,
    stops,
    states,
    flush,
    advance: (ms: number) => (now += ms),
    setRequestStop: (next: () => Promise<void>) => (requestStop = next),
  }
}

const env = { TELER_URL: 'https://app.teler.ai' }

describe('daemon supervisor', () => {
  it('starts one daemon and ignores duplicate starts', async () => {
    const { supervisor, daemons } = harness()
    await supervisor.start(env)
    await supervisor.start(env)
    expect(daemons).toHaveLength(1)
    expect(supervisor.state).toBe('running')
  })

  it('restarts a crashed daemon with exponential backoff', async () => {
    const { supervisor, daemons, waits, flush, states } = harness()
    await supervisor.start(env)
    daemons[0]!.exit(1)
    await flush()
    expect(supervisor.state).toBe('restarting')
    expect(waits.map((wait) => wait.ms)).toEqual([1_000])
    waits[0]!.resolve()
    await flush()
    expect(daemons).toHaveLength(2)
    daemons[1]!.exit(1)
    await flush()
    expect(waits.map((wait) => wait.ms)).toEqual([1_000, 2_000])
    expect(states).toEqual(['running', 'restarting', 'running', 'restarting'])
  })

  it('resets the backoff after a stable run', async () => {
    const { supervisor, daemons, waits, flush, advance } = harness()
    await supervisor.start(env)
    daemons[0]!.exit(1)
    await flush()
    waits[0]!.resolve()
    await flush()
    advance(61_000)
    daemons[1]!.exit(1)
    await flush()
    expect(waits.map((wait) => wait.ms)).toEqual([1_000, 1_000])
  })

  it('asks an orphaned lease owner to stop before taking over', async () => {
    const { supervisor, daemons, stops, waits, flush } = harness()
    await supervisor.start(env)
    daemons[0]!.exit(0)
    await flush()
    expect(stops).toEqual([env])
    waits[0]!.resolve()
    await flush()
    expect(daemons).toHaveLength(2)
  })

  it('stops gracefully and never restarts a stopped daemon', async () => {
    const { supervisor, daemons, stops, flush } = harness()
    await supervisor.start(env)
    const stopping = supervisor.stop()
    await flush()
    daemons[0]!.exit(0)
    await stopping
    await flush()
    expect(stops).toEqual([env])
    expect(daemons[0]!.killed).toBe(false)
    expect(daemons).toHaveLength(1)
    expect(supervisor.state).toBe('stopped')
  })

  it('relaunches a running daemon with its environment, and nothing when stopped', async () => {
    const { supervisor, daemons, flush } = harness()
    await supervisor.relaunch()
    expect(daemons).toHaveLength(0)
    await supervisor.start(env)
    const relaunching = supervisor.relaunch()
    await flush()
    daemons[0]!.exit(0)
    await relaunching
    expect(daemons).toHaveLength(2)
    expect(supervisor.state).toBe('running')
    const stopping = supervisor.stop()
    await flush()
    daemons[1]!.exit(0)
    await stopping
    await supervisor.relaunch()
    expect(daemons).toHaveLength(2)
    expect(supervisor.state).toBe('stopped')
  })

  it('kills a daemon that ignores the stop request', async () => {
    const { supervisor, daemons, waits, flush } = harness()
    await supervisor.start(env)
    const stopping = supervisor.stop()
    await flush()
    waits.find((wait) => wait.ms === 15_000)!.resolve()
    await stopping
    expect(daemons[0]!.killed).toBe(true)
  })

  it('cancels a pending restart when stopped', async () => {
    const { supervisor, daemons, waits, flush } = harness()
    await supervisor.start(env)
    daemons[0]!.exit(1)
    await flush()
    await supervisor.stop()
    waits[0]!.resolve()
    await flush()
    expect(daemons).toHaveLength(1)
    expect(supervisor.state).toBe('stopped')
  })

  it('restarts with a new environment', async () => {
    const { supervisor, daemons, flush } = harness()
    await supervisor.start(env)
    const restarting = supervisor.restart({ ...env, TELER_TOKEN: 'new' })
    await flush()
    daemons[0]!.exit(0)
    await restarting
    expect(daemons).toHaveLength(2)
    expect(supervisor.state).toBe('running')
  })

  it('keeps a stop made while taking over from an orphaned daemon', async () => {
    let release: () => void = () => undefined
    const { supervisor, daemons, flush, setRequestStop } = harness()
    await supervisor.start(env)
    // The orphan takeover waits on `teler sync stop`; a user pause lands meanwhile.
    setRequestStop(() => new Promise<void>((resolve) => (release = resolve)))
    daemons[0]!.exit(0)
    await flush()
    const stopping = supervisor.stop()
    await flush()
    release()
    await stopping
    await flush()
    expect(supervisor.state).toBe('stopped')
    await supervisor.start(env)
    expect(daemons).toHaveLength(2)
    expect(supervisor.state).toBe('running')
  })

  it('runs a start requested while a stop still waits for the daemon', async () => {
    const { supervisor, daemons, flush } = harness()
    await supervisor.start(env)
    const stopping = supervisor.stop()
    const starting = supervisor.start(env)
    await flush()
    daemons[0]!.exit(0)
    await stopping
    await starting
    expect(daemons).toHaveLength(2)
    expect(supervisor.state).toBe('running')
  })

  it('never starts a daemon after shutdown, even mid-restart or mid-backoff', async () => {
    const { supervisor, daemons, flush } = harness()
    await supervisor.start(env)
    const restarting = supervisor.restart({ ...env, TELER_TOKEN: 'new' })
    const shuttingDown = supervisor.shutdown()
    await flush()
    daemons[0]!.exit(0)
    await restarting
    await shuttingDown
    await supervisor.start(env)
    expect(daemons).toHaveLength(1)
    expect(supervisor.state).toBe('stopped')

    const crashed = harness()
    await crashed.supervisor.start(env)
    crashed.daemons[0]!.exit(1)
    await crashed.flush()
    await crashed.supervisor.shutdown()
    crashed.waits[0]!.resolve()
    await crashed.flush()
    expect(crashed.daemons).toHaveLength(1)
    expect(crashed.supervisor.state).toBe('stopped')
  })
})
