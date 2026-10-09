import { describe, expect, it } from 'vitest'
import { DeviceLoginError } from '../../src/main/device-login'
import { credential, harness, registration } from './sync-controller-harness'

describe('sync controller connection', () => {
  it('starts the daemon with the stored token on launch', async () => {
    const { controller, log } = harness({ credential })
    await controller.init()
    expect(log).toEqual(['start old-token'])
    expect(controller.state.connection).toMatchObject({
      status: 'connected',
      account: credential.account,
    })
    expect(controller.state.health).toBe('no-folders')
  })

  it('stays disconnected and idle without a credential or while paused', async () => {
    const disconnected = harness()
    await disconnected.controller.init()
    expect(disconnected.log).toEqual([])
    expect(disconnected.controller.state.health).toBe('not-connected')
    const paused = harness({ credential, syncPaused: true })
    await paused.controller.init()
    expect(paused.log).toEqual([])
  })

  it('connects in one click: approves its own code, then restarts sync with the new token', async () => {
    const { controller, log, flush, issue, stored } = harness({ credential })
    await controller.init()
    const result = controller.connect()
    await flush()
    expect(controller.state.connection).toMatchObject({ status: 'connecting', error: null })
    issue('new-token')
    expect(await result).toEqual({ ok: true, value: null })
    expect(stored()).toMatchObject({ token: 'new-token', account: { id: 'user_1', name: 'Ana' } })
    expect(log).toEqual([
      'start old-token',
      'approve ABCD2345',
      'revoke old-token',
      'restart new-token',
    ])
    expect(controller.state.connection).toEqual({
      status: 'connected',
      account: { id: 'user_1', name: 'Ana' },
      error: null,
    })
  })

  it('needs someone signed in to the Teler window and keeps an existing connection', async () => {
    const { controller, log } = harness({
      credential,
      approveError: new DeviceLoginError('signed-out'),
    })
    await controller.init()
    expect(await controller.connect()).toEqual({ ok: false, error: 'signed-out' })
    expect(log).toEqual(['start old-token', 'approve ABCD2345'])
    expect(controller.state.connection).toMatchObject({
      status: 'connected',
      error: 'signed-out',
    })
  })

  it('reports denial and keeps an existing connection', async () => {
    const { controller, flush, reject } = harness({ credential })
    await controller.init()
    const result = controller.connect()
    await flush()
    reject(new DeviceLoginError('connect-denied'))
    expect(await result).toEqual({ ok: false, error: 'connect-denied' })
    expect(controller.state.connection).toMatchObject({
      status: 'connected',
      error: 'connect-denied',
    })
  })

  it('rejects tokens without an organization', async () => {
    const { controller, log, flush, issue, stored } = harness()
    await controller.init()
    const result = controller.connect()
    await flush()
    issue('no-org')
    expect(await result).toEqual({ ok: false, error: 'no-organization' })
    expect(log).toContain('revoke no-org')
    expect(stored()).toBeNull()
    expect(controller.state.connection).toMatchObject({
      status: 'disconnected',
      error: 'no-organization',
    })
  })

  it('reports an account without folder sync and keeps no token', async () => {
    const { controller, log, flush, issue, stored } = harness()
    await controller.init()
    const result = controller.connect()
    await flush()
    issue('refused')
    expect(await result).toEqual({ ok: false, error: 'not-eligible' })
    expect(stored()).toBeNull()
    expect(log).toContain('revoke refused')
    expect(log.some((entry) => entry.startsWith('restart'))).toBe(false)
    expect(controller.state.connection).toMatchObject({
      status: 'disconnected',
      error: 'not-eligible',
    })
  })

  it('revokes an approved token it fails to keep', async () => {
    const { controller, log, flush, issue, stored } = harness()
    await controller.init()
    const result = controller.connect()
    await flush()
    issue('unwritable')
    expect(await result).toEqual({ ok: false, error: 'sync-failed' })
    expect(stored()).toBeNull()
    expect(log).toContain('revoke unwritable')
    expect(controller.state.connection).toMatchObject({
      status: 'disconnected',
      error: 'sync-failed',
    })
  })

  it('keeps an approved token when only restarting sync fails', async () => {
    const { controller, log, flush, issue, stored } = harness()
    await controller.init()
    const result = controller.connect()
    await flush()
    issue('unstartable')
    expect(await result).toEqual({ ok: false, error: 'sync-failed' })
    expect(stored()?.token).toBe('unstartable')
    expect(log).not.toContain('revoke unstartable')
    expect(controller.state.connection).toMatchObject({
      status: 'connected',
      error: 'sync-failed',
    })
  })

  it('keeps no token from a connection interrupted by disconnecting', async () => {
    const { controller, log, flush, issue, stored } = harness()
    await controller.init()
    const result = controller.connect()
    await flush()
    await controller.disconnect()
    issue('late-token')
    await result
    expect(stored()).toBeNull()
    expect(log).toContain('revoke late-token')
    expect(controller.state.connection.status).toBe('disconnected')
  })

  it('shares one connection attempt between simultaneous requests', async () => {
    const { controller, log, flush, issue } = harness()
    await controller.init()
    const first = controller.connect()
    const second = controller.connect()
    await flush()
    issue('new-token')
    expect(await first).toEqual({ ok: true, value: null })
    expect(await second).toEqual({ ok: true, value: null })
    expect(log.filter((entry) => entry.startsWith('approve'))).toHaveLength(1)
  })

  it('disconnects by stopping sync, clearing and revoking the credential', async () => {
    const { controller, log, stored } = harness({ credential })
    await controller.init()
    await controller.disconnect()
    expect(log).toEqual(['start old-token', 'stop', 'revoke old-token'])
    expect(stored()).toBeNull()
    expect(controller.state.health).toBe('not-connected')
  })

  it('notifies once when sync needs the user to sign in again', async () => {
    const { controller, log, setRegistrations } = harness({ credential })
    setRegistrations([registration({ status: 'authentication-required' })])
    await controller.init()
    await controller.refresh()
    expect(log.filter((entry) => entry === 'notify')).toHaveLength(1)
    expect(controller.state.health).toBe('sign-in-required')
  })

  it('shuts the daemon down for good when the app quits', async () => {
    const { controller, log } = harness({ credential })
    await controller.init()
    await controller.shutdown()
    expect(log).toEqual(['start old-token', 'shutdown'])
  })

  it('runs CLI commands with the token current at call time', async () => {
    const { controller, cliToken, flush, issue } = harness({ credential })
    expect(cliToken()).toBeUndefined()
    await controller.init()
    expect(cliToken()).toBe('old-token')
    const result = controller.connect()
    await flush()
    issue('new-token')
    await result
    expect(cliToken()).toBe('new-token')
    await controller.disconnect()
    expect(cliToken()).toBeUndefined()
  })
})
