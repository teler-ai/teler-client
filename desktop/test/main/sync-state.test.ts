import { describe, expect, it } from 'vitest'
import type { SyncedFolder } from '../../src/shared/desktop-api'
import { SyncCli, SyncCliError, errorCodeFor, type CliRunner } from '../../src/main/sync-cli'
import { pendingFileCount, summarizeHealth, toSyncedFolder } from '../../src/main/sync-state'

function registration(overrides: Partial<Parameters<typeof toSyncedFolder>[0]> = {}) {
  return {
    id: 'reg_1',
    localPath: '/Users/ana/Reports',
    origin: 'https://app.teler.ai',
    accountId: 'user_1',
    organizationId: 'org_1',
    destination: '/personal/Reports',
    paused: false,
    status: 'ready',
    checkedAt: 1,
    files: [] as Array<{
      relativePath: string
      status: string
      retryAt?: number
      error?: string | null
    }>,
    ...overrides,
  }
}

function folder(status: SyncedFolder['status']): SyncedFolder {
  return { ...toSyncedFolder(registration()), status }
}

describe('folder view model', () => {
  it('counts files by outcome and lists problems in path order', () => {
    const view = toSyncedFolder(
      registration({
        status: 'attention-required',
        files: [
          { relativePath: 'b.csv', status: 'failed' },
          { relativePath: 'a.csv', status: 'conflict' },
          { relativePath: 'c.csv', status: 'ready' },
          { relativePath: 'd.csv', status: 'processing' },
          { relativePath: 'e.zip', status: 'unsupported' },
          { relativePath: '.env', status: 'excluded' },
        ],
      })
    )
    expect(view).toMatchObject({
      name: 'Reports',
      status: 'attention',
      counts: { synced: 1, pending: 1, problems: 2, skipped: 2 },
    })
    expect(view.problemFiles.map((file) => file.relativePath)).toEqual(['a.csv', 'b.csv'])
  })

  it('maps CLI registration states and pause', () => {
    expect(toSyncedFolder(registration({ status: 'authentication-required' })).status).toBe(
      'sign-in-required'
    )
    expect(toSyncedFolder(registration({ status: 'connection-unavailable' })).status).toBe(
      'offline'
    )
    expect(toSyncedFolder(registration({ status: 'root-unavailable' })).status).toBe('unavailable')
    expect(toSyncedFolder(registration({ paused: true, status: 'paused' })).status).toBe('paused')
    expect(toSyncedFolder(registration({ status: 'something-new' })).status).toBe('pending')
  })

  it('shows retrying files as waiting, with when and why, rather than as problems', () => {
    const view = toSyncedFolder(
      registration({
        // The CLI marks the folder for attention; for the app it is only waiting.
        status: 'attention-required',
        files: [
          { relativePath: 'late.csv', status: 'retrying', retryAt: 3_000, error: 'HTTP_503' },
          { relativePath: 'soon.csv', status: 'retrying', retryAt: 2_000, error: 'RATE_LIMITED' },
          { relativePath: 'done.csv', status: 'ready' },
        ],
      })
    )
    expect(view.status).toBe('pending')
    expect(view.counts).toMatchObject({ synced: 1, pending: 0, waiting: 2, problems: 0 })
    expect(view.nextRetryAt).toBe(2_000)
    expect(view.waitingFiles).toEqual([
      { relativePath: 'soon.csv', status: 'retrying', retryAt: 2_000, reason: 'RATE_LIMITED' },
      { relativePath: 'late.csv', status: 'retrying', retryAt: 3_000, reason: 'HTTP_503' },
    ])
    expect(view.problemFiles).toEqual([])
  })

  it('still needs attention when a real problem remains beside waiting files', () => {
    const view = toSyncedFolder(
      registration({
        status: 'attention-required',
        files: [
          { relativePath: 'bad.csv', status: 'failed', error: 'FORMAT_UNSUPPORTED' },
          { relativePath: 'slow.csv', status: 'retrying', retryAt: 5_000, error: 'NETWORK' },
        ],
      })
    )
    expect(view.status).toBe('attention')
    expect(view.counts).toMatchObject({ waiting: 1, problems: 1 })
    expect(view.problemFiles).toEqual([
      { relativePath: 'bad.csv', status: 'failed', retryAt: null, reason: 'FORMAT_UNSUPPORTED' },
    ])
  })

  it('carries the organization and project the folder syncs into', () => {
    expect(toSyncedFolder(registration(), null)).toMatchObject({
      organizationId: 'org_1',
      projectId: null,
      projectName: null,
      nextRetryAt: null,
    })
    expect(toSyncedFolder(registration({ projectId: 'prj_1' }), null, 'Q3 Plan')).toMatchObject({
      projectId: 'prj_1',
      projectName: 'Q3 Plan',
    })
  })

  it('marks folders registered by another account', () => {
    expect(toSyncedFolder(registration({ accountId: 'user_2' }), 'user_1').status).toBe(
      'other-account'
    )
    expect(toSyncedFolder(registration({ accountId: 'user_1' }), 'user_1').status).toBe('ready')
    expect(toSyncedFolder(registration({ accountId: 'user_2' }), null).status).toBe('ready')
  })

  it('caps the problem list', () => {
    const files = Array.from({ length: 30 }, (_, index) => ({
      relativePath: `f${String(index).padStart(2, '0')}.csv`,
      status: 'failed',
    }))
    expect(toSyncedFolder(registration({ files })).problemFiles).toHaveLength(20)
  })
})

describe('overall health', () => {
  const base = { connected: true, syncPaused: false, daemonRestarting: false }

  it('prioritises connection, then pause, then the most urgent folder', () => {
    expect(summarizeHealth({ ...base, connected: false, folders: [folder('ready')] })).toBe(
      'not-connected'
    )
    expect(summarizeHealth({ ...base, folders: [] })).toBe('no-folders')
    expect(summarizeHealth({ ...base, syncPaused: true, folders: [folder('pending')] })).toBe(
      'paused'
    )
    expect(
      summarizeHealth({ ...base, folders: [folder('pending'), folder('sign-in-required')] })
    ).toBe('sign-in-required')
    expect(summarizeHealth({ ...base, daemonRestarting: true, folders: [folder('ready')] })).toBe(
      'stopped'
    )
    expect(summarizeHealth({ ...base, folders: [folder('offline'), folder('attention')] })).toBe(
      'offline'
    )
    expect(summarizeHealth({ ...base, folders: [folder('pending'), folder('unavailable')] })).toBe(
      'attention'
    )
    expect(summarizeHealth({ ...base, folders: [folder('pending'), folder('ready')] })).toBe(
      'syncing'
    )
    expect(summarizeHealth({ ...base, folders: [folder('paused'), folder('paused')] })).toBe(
      'paused'
    )
    expect(summarizeHealth({ ...base, folders: [folder('paused'), folder('ready')] })).toBe(
      'up-to-date'
    )
  })

  it('totals files still to upload, including those waiting to retry', () => {
    const counts = { synced: 0, problems: 0, skipped: 0 }
    const one = { ...folder('pending'), counts: { ...counts, pending: 2, waiting: 0 } }
    const two = { ...folder('pending'), counts: { ...counts, pending: 3, waiting: 4 } }
    expect(pendingFileCount([one, two])).toBe(9)
  })
})

describe('CLI client', () => {
  function runner(result: {
    exitCode?: number
    stdout?: string
    stderr?: string
    timedOut?: boolean
  }) {
    const calls: string[][] = []
    const fake: CliRunner = {
      async run(args) {
        calls.push([...args])
        return { exitCode: 0, stdout: '', stderr: '', ...result }
      },
    }
    return { fake, calls }
  }

  it('retries a folder now through the CLI', async () => {
    const { fake, calls } = runner({
      stdout: JSON.stringify({ daemonRunning: true, throttledUntil: null, registrations: [] }),
    })
    await new SyncCli(fake).retry('reg_1')
    expect(calls[0]).toEqual(['sync', 'retry', 'reg_1', '--json'])
  })

  it('passes folder input as separate arguments and parses JSON', async () => {
    const { fake, calls } = runner({
      stdout: JSON.stringify({
        localPath: '/x',
        destination: '/personal/x',
        files: [{ relativePath: 'a.csv', hash: 'h', bytes: 3 }],
        skipped: [],
      }),
    })
    const preview = await new SyncCli(fake).preview({
      localPath: '/x --to /organization',
      destination: '/personal/x',
    })
    expect(calls[0]).toEqual([
      'sync',
      '/x --to /organization',
      '--to',
      '/personal/x',
      '--dry-run',
      '--json',
    ])
    expect(preview.files).toEqual([{ relativePath: 'a.csv', bytes: 3 }])
  })

  it('maps fixed CLI errors to codes without exposing output', async () => {
    const { fake } = runner({ exitCode: 2, stderr: 'teler: No active organization; pass --org' })
    await expect(
      new SyncCli(fake).register({ localPath: '/x', destination: '/personal/x' })
    ).rejects.toMatchObject({ code: 'no-organization' })
    expect(errorCodeFor('teler: Not authenticated. Run `teler auth login`.')).toBe('not-connected')
    expect(errorCodeFor('teler: Sync folder must be a local directory, not a symlink')).toBe(
      'invalid-folder'
    )
    expect(errorCodeFor('teler: Teler API request could not be completed')).toBe('network')
    expect(errorCodeFor('teler: Teler API request failed (503)')).toBe('network')
    expect(errorCodeFor('teler: Teler API request failed (401)')).toBe('not-connected')
    expect(errorCodeFor('teler: Teler API request failed (4013 X)')).toBe('sync-failed')
    expect(errorCodeFor('teler: something unexpected')).toBe('sync-failed')
  })

  it('reports a command stopped at its time limit as a timeout', async () => {
    const { fake } = runner({ exitCode: 1, timedOut: true })
    await expect(
      new SyncCli(fake).preview({ localPath: '/huge', destination: '/personal/huge' })
    ).rejects.toMatchObject({ code: 'timeout' })
  })

  it('rejects malformed output', async () => {
    const { fake } = runner({ stdout: '{"daemonRunning":"yes"}' })
    await expect(new SyncCli(fake).list()).rejects.toBeInstanceOf(SyncCliError)
  })
})
