import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  shouldCheckForUpdates,
  startUpdateNotice,
  updateCheckPath,
  type UpdateNoticeDeps,
} from '../src/update-check'
import { releaseListing, releaseServer } from './release-fixtures'

const COMPILED = 'file:///$bunfs/root/teler-linux-x64'
let home = ''
afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true })
  home = ''
})

function deps(overrides: Partial<UpdateNoticeDeps> = {}): UpdateNoticeDeps {
  return {
    env: {},
    moduleUrl: COMPILED,
    // Startup cleanup looks next to the executable; keep it away from real files.
    execPath: '/nonexistent-teler-test/teler',
    interactive: true,
    home,
    currentVersion: '0.1.0',
    now: () => 1_000_000,
    ...overrides,
  }
}

async function notice(argv: string[], options: Partial<UpdateNoticeDeps>) {
  let text = ''
  await startUpdateNotice(argv, deps(options)).finish((value) => (text += value))
  return text
}

describe('update check on startup', () => {
  test('runs only for a person using a release build', () => {
    expect(shouldCheckForUpdates(['chat', 'list'], deps())).toBe(true)
    for (const [argv, overrides] of [
      [['chat', 'list'], { moduleUrl: 'file:///home/a/cli/src/index.ts' }],
      [['chat', 'list'], { interactive: false }],
      [['chat', 'list', '--json'], {}],
      [['update'], {}],
      [['sync', 'daemon'], {}],
      [['chat', 'list'], { env: { TELER_NO_UPDATE_CHECK: '1' } }],
      [['chat', 'list'], { env: { CI: 'true' } }],
      [['sync', 'list'], { env: { TELER_SYNC_DAEMON: 'managed' } }],
    ] as const)
      expect(shouldCheckForUpdates(argv, deps(overrides))).toBe(false)
  })

  test('announces a newer release once a day', async () => {
    home = await mkdtemp(join(tmpdir(), 'teler-update-check-'))
    const server = releaseServer(releaseListing([{ tag: 'cli-v0.2.0' }]))
    expect(await notice(['chat', 'list'], { fetch: server.fetch })).toBe(
      '\nteler 0.2.0 is available (you have 0.1.0). Run `teler update`.\n'
    )
    const cached = JSON.parse(await readFile(updateCheckPath({}, home), 'utf8'))
    expect(cached).toEqual({ checkedAt: 1_000_000, latest: '0.2.0' })
    expect(await notice(['chat', 'list'], { fetch: server.fetch, now: () => 2_000_000 })).toBe('')
    expect(server.requests).toHaveLength(1)
    const tomorrow = 1_000_000 + 24 * 60 * 60_000
    expect(await notice(['chat', 'list'], { fetch: server.fetch, now: () => tomorrow })).not.toBe(
      ''
    )
    expect(server.requests).toHaveLength(2)
  })

  test('retries a failed check after an hour, not on every command', async () => {
    home = await mkdtemp(join(tmpdir(), 'teler-update-check-'))
    let calls = 0
    const failing = async () => {
      calls += 1
      return new Response('rate limited', { status: 403 })
    }
    expect(await notice(['chat', 'list'], { fetch: failing })).toBe('')
    expect(
      await notice(['chat', 'list'], { fetch: failing, now: () => 1_000_000 + 59 * 60_000 })
    ).toBe('')
    expect(calls).toBe(1)
    expect(
      await notice(['chat', 'list'], { fetch: failing, now: () => 1_000_000 + 61 * 60_000 })
    ).toBe('')
    expect(calls).toBe(2)
  })

  test('stays quiet when up to date or when the check fails', async () => {
    home = await mkdtemp(join(tmpdir(), 'teler-update-check-'))
    const current = releaseServer(releaseListing([{ tag: 'cli-v0.1.0' }]))
    expect(await notice(['chat', 'list'], { fetch: current.fetch })).toBe('')
    const failing = async () => new Response('Not Found', { status: 404 })
    expect(await notice(['chat', 'list'], { fetch: failing, now: () => 9e12 })).toBe('')
  })
})
