import { describe, expect, it } from 'vitest'
import type { ConnectionState, DesktopResult } from '../../src/shared/desktop-api'
import { SyncSession, type SessionUser } from '../../src/main/sync-session'

interface Options {
  connection?: ConnectionState
  autoConnect?: boolean
  session?: SessionUser | undefined
}

const connectedAs = (id: string): ConnectionState => ({
  status: 'connected',
  account: { id, name: null },
  error: null,
})
const DISCONNECTED: ConnectionState = { status: 'disconnected', account: null, error: null }

function setup(options: Options = {}) {
  const log: string[] = []
  let connection = options.connection ?? DISCONNECTED
  let session = 'session' in options ? options.session : null
  let releaseSession: (() => void) | null = null
  // A connection in progress settles when the test finishes it.
  let finishConnecting: (() => void) | null = null
  const settings = { value: { autoConnect: options.autoConnect ?? false } }
  const sync = new SyncSession({
    controller: {
      get state() {
        return { connection }
      },
      async connect(): Promise<DesktopResult<null>> {
        log.push('connect')
        if (session) connection = connectedAs(session.id)
        return { ok: true, value: null }
      },
      async disconnect() {
        log.push('disconnect')
        connection = DISCONNECTED
      },
      settled: () =>
        connection.status === 'connecting'
          ? new Promise<void>((resolve) => (finishConnecting = resolve))
          : Promise.resolve(),
    },
    settings: {
      value: settings.value,
      update: async (patch) => {
        log.push(`autoConnect ${patch.autoConnect}`)
        Object.assign(settings.value, patch)
      },
    },
    // A read reports the session as it was when the read started.
    readSession: async () => {
      log.push('read')
      const current = session
      if (releaseSession === null) return current
      await new Promise<void>((resolve) => (releaseSession = resolve))
      return current
    },
  })
  return {
    sync,
    log,
    settings: settings.value,
    signIn: (id: string) => (session = { id }),
    finishConnecting: (id: string) => {
      connection = connectedAs(id)
      finishConnecting?.()
    },
    signOut: () => (session = null),
    holdSession: () => (releaseSession = () => undefined),
    release: () => {
      const release = releaseSession
      releaseSession = null
      release?.()
    },
  }
}

describe('sync session', () => {
  it('remembers that a user who connects wants sync to follow their sign-ins', async () => {
    const { sync, log, settings } = setup({ session: { id: 'user_1' } })
    expect(await sync.connect()).toEqual({ ok: true, value: null })
    expect(settings.autoConnect).toBe(true)
    expect(log).toEqual(['autoConnect true', 'connect'])
  })

  it('stays disconnected after an explicit disconnect, even when signed in', async () => {
    const { sync, log, settings } = setup({
      connection: connectedAs('user_1'),
      autoConnect: true,
      session: { id: 'user_1' },
    })
    await sync.disconnect()
    expect(settings.autoConnect).toBe(false)
    log.length = 0
    await sync.check()
    expect(log).toEqual(['read'])
  })

  it('disconnects when the window signs out and keeps following', async () => {
    const { sync, log, settings } = setup({
      connection: connectedAs('user_1'),
      autoConnect: true,
      session: null,
    })
    await sync.check()
    expect(log).toEqual(['read', 'disconnect'])
    expect(settings.autoConnect).toBe(true)
  })

  it('reconnects on sign-in when the user had connected', async () => {
    const { sync, log } = setup({ autoConnect: true, session: { id: 'user_1' } })
    await sync.check()
    expect(log).toEqual(['read', 'connect'])
    const never = setup({ autoConnect: false, session: { id: 'user_1' } })
    await never.sync.check()
    expect(never.log).toEqual(['read'])
  })

  it('moves sync to a different account that signs in', async () => {
    const { sync, log } = setup({
      connection: connectedAs('user_1'),
      autoConnect: true,
      session: { id: 'user_2' },
    })
    await sync.check()
    expect(log).toEqual(['read', 'disconnect', 'connect'])
  })

  it('keeps the connection for the same account or an unreadable session', async () => {
    const same = setup({ connection: connectedAs('user_1'), session: { id: 'user_1' } })
    await same.sync.check()
    expect(same.log).toEqual(['read'])
    const unknown = setup({ connection: connectedAs('user_1'), session: undefined })
    await unknown.sync.check()
    expect(unknown.log).toEqual(['read'])
  })

  it('follows a sign-out that happens while a connection is in progress', async () => {
    const { sync, log, finishConnecting } = setup({
      connection: { status: 'connecting', account: null, error: null },
      autoConnect: true,
      session: null,
    })
    const checked = sync.check()
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Nothing is decided until the connection settles…
    expect(log).toEqual(['read'])
    finishConnecting('user_1')
    await checked
    // …then the session is read again and the signed-out window wins.
    expect(log).toEqual(['read', 'read', 'disconnect'])
  })

  it('starts following a connection made before sync followed sessions', async () => {
    const { sync, settings, log } = setup({
      connection: connectedAs('user_1'),
      session: { id: 'user_1' },
    })
    await sync.start()
    expect(settings.autoConnect).toBe(true)
    expect(log).toEqual(['autoConnect true', 'read'])
  })

  it('reads the session again when it changes during a check', async () => {
    const { sync, log, holdSession, release, signIn } = setup({ autoConnect: true })
    holdSession()
    const first = sync.check()
    await Promise.resolve()
    signIn('user_1')
    const second = sync.check()
    release()
    await first
    await second
    // The change arrived during the first read, so a second read follows it.
    expect(log.filter((entry) => entry === 'read')).toHaveLength(2)
    expect(log.at(-1)).toBe('connect')
  })
})
