import { describe, expect, it } from 'vitest'
import { SyncCliError } from '../../src/main/sync-cli'
import { credential, harness, registration } from './sync-controller-harness'

describe('sync controller folders', () => {
  it('previews and adds folders with validated, canonical paths', async () => {
    const { controller, log } = harness({ credential })
    await controller.init()
    const input = { localPath: '/home/ana/Exports/', destination: '/personal/Exports' }
    expect(await controller.preview(input)).toMatchObject({
      ok: true,
      value: { fileCount: 1, totalBytes: 10, skipped: { excluded: 1, unsupported: 0, other: 0 } },
    })
    const added = await controller.add(input)
    expect(added).toMatchObject({ ok: true, value: { id: 'reg_new', status: 'pending' } })
    expect(log).toContain('register /home/ana/Exports /personal/Exports')
    expect(controller.state.health).toBe('syncing')
  })

  it('adds a folder into the organization and project the web app asked for', async () => {
    const { controller, log } = harness({ credential })
    await controller.init()
    const added = await controller.add({
      localPath: '/home/ana/Q3',
      destination: '/organization/Q3',
      organizationId: 'org_2',
      projectId: 'prj_1',
    })
    expect(added.ok).toBe(true)
    expect(log).toContain('register /home/ana/Q3 /organization/Q3 org_2 prj_1')
  })

  it('refuses invalid, missing, overlapping and unauthenticated folders', async () => {
    const { controller, setRegistrations } = harness({ credential })
    setRegistrations([registration()])
    await controller.init()
    expect(await controller.add({ localPath: '/x', destination: '/shared/x' })).toEqual({
      ok: false,
      error: 'invalid-destination',
    })
    expect(await controller.add({ localPath: '/missing', destination: '/personal/x' })).toEqual({
      ok: false,
      error: 'invalid-folder',
    })
    for (const localPath of ['/home/ana/Reports', '/home/ana/Reports/2026', '/home/ana'])
      expect(await controller.preview({ localPath, destination: '/personal/x' })).toEqual({
        ok: false,
        error: 'already-synced',
      })
    expect(
      await controller.preview({ localPath: '/home/ana/Reports-old', destination: '/personal/x' })
    ).toMatchObject({ ok: true })
    const disconnected = harness()
    await disconnected.controller.init()
    expect(
      await disconnected.controller.add({ localPath: '/y', destination: '/personal/y' })
    ).toEqual({ ok: false, error: 'not-connected' })
  })

  it('maps CLI failures to error codes', async () => {
    const { controller } = harness({
      credential,
      registerError: new SyncCliError('no-organization'),
    })
    await controller.init()
    expect(await controller.add({ localPath: '/z', destination: '/personal/z' })).toEqual({
      ok: false,
      error: 'no-organization',
    })
  })

  it('pauses, resumes and removes only known folders', async () => {
    const { controller, log, setRegistrations } = harness({ credential })
    setRegistrations([registration()])
    await controller.init()
    expect(await controller.pause('reg_1')).toEqual({ ok: true, value: null })
    expect(await controller.resume('reg_1')).toEqual({ ok: true, value: null })
    expect(await controller.remove('reg_1')).toEqual({ ok: true, value: null })
    expect(await controller.pause('unknown')).toEqual({ ok: false, error: 'invalid-folder' })
    expect(log.slice(-3)).toEqual(['pause reg_1', 'resume reg_1', 'remove reg_1'])
    expect(controller.state.folders).toEqual([])
  })

  it('retries a known folder now', async () => {
    const { controller, log, setRegistrations } = harness({ credential })
    setRegistrations([registration()])
    await controller.init()
    expect(await controller.retry('reg_1')).toEqual({ ok: true, value: null })
    expect(await controller.retry('unknown')).toEqual({ ok: false, error: 'invalid-folder' })
    expect(log).toContain('retry reg_1')
  })

  it('reports when Teler limits upload starts', async () => {
    const limited = harness({ credential, throttledUntil: 90_000 })
    await limited.controller.init()
    expect(limited.controller.state.throttledUntil).toBe(90_000)
    const free = harness({ credential })
    await free.controller.init()
    expect(free.controller.state.throttledUntil).toBeNull()
  })

  it('remembers the name of the project a folder syncs into', async () => {
    const { controller, projectName } = harness({ credential })
    await controller.init()
    const added = await controller.add({
      localPath: '/home/ana/Q3',
      destination: '/organization/Q3',
      organizationId: 'org_2',
      projectId: 'prj_1',
      projectName: 'Q3 Plan',
    })
    expect(added).toMatchObject({ ok: true, value: { projectName: 'Q3 Plan' } })
    expect(controller.state.folders[0]).toMatchObject({
      projectId: 'prj_1',
      projectName: 'Q3 Plan',
    })
    // Removing the folder forgets the name too.
    await controller.remove('reg_new')
    expect(projectName('reg_new')).toBeNull()
  })

  it('pauses all syncing by stopping the daemon', async () => {
    const { controller, log, setRegistrations } = harness({ credential })
    setRegistrations([registration()])
    await controller.init()
    await controller.setSyncPaused(true)
    expect(controller.state.health).toBe('paused')
    await controller.setSyncPaused(false)
    expect(log).toEqual(['start old-token', 'stop', 'start old-token'])
  })

  it('reads status again after an action instead of reusing an older read', async () => {
    const { controller, setRegistrations, holdStatus, releaseStatus, flush } = harness({
      credential,
    })
    setRegistrations([registration()])
    await controller.init()
    holdStatus()
    const polling = controller.poll()
    const pausing = controller.pause('reg_1')
    await flush()
    releaseStatus()
    await polling
    expect(await pausing).toEqual({ ok: true, value: null })
    expect(controller.state.folders[0]?.status).toBe('paused')
  })

  it('polls every tick while connected and once a minute while disconnected', async () => {
    const connected = harness({ credential })
    await connected.controller.init()
    await connected.controller.poll()
    expect(connected.statusReads()).toBe(2)

    const idle = harness()
    await idle.controller.init()
    await idle.controller.poll()
    expect(idle.statusReads()).toBe(1)
    idle.advance(60_000)
    await idle.controller.poll()
    expect(idle.statusReads()).toBe(2)
  })

  it('flags folders that another account registered', async () => {
    const { controller, setRegistrations } = harness({ credential })
    setRegistrations([
      registration({ id: 'mine' }),
      registration({
        id: 'theirs',
        localPath: '/home/ana/Old',
        accountId: 'user_2',
        status: 'authentication-required',
      }),
    ])
    await controller.init()
    expect(controller.state.folders.map((folder) => folder.status)).toEqual([
      'ready',
      'other-account',
    ])
    // Reconnecting cannot fix another account's folder, so it is not "sign in again".
    expect(controller.state.health).toBe('attention')
  })

  it('shows only folders for the configured origin and reports restarts', async () => {
    const { controller, setRegistrations } = harness({ credential })
    setRegistrations([registration(), registration({ id: 'other', origin: 'https://x.example' })])
    await controller.init()
    expect(controller.state.folders.map((folder) => folder.id)).toEqual(['reg_1'])
    controller.supervisorChanged('restarting')
    expect(controller.state.health).toBe('stopped')
  })
})
