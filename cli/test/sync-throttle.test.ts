import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError } from '../src/errors'
import { main } from '../src/index'
import { reconcile } from '../src/sync-engine'
import { syncDirectory } from '../src/sync-paths'
import { createSyncRemote } from '../src/sync-remote'
import { uploadRetryDelay } from '../src/upload-retry'
import { SyncStore } from '../src/sync-store'
import type { SyncRemote } from '../src/sync-types'

const roots: string[] = []
async function fixture(fileCount: number) {
  const root = await mkdtemp(join(tmpdir(), 'sync-throttle-'))
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(source)
  for (let index = 0; index < fileCount; index++) {
    const path = join(source, `data-${index}.csv`)
    await writeFile(path, `a\n${index}\n`)
    await utimes(path, new Date(0), new Date(0))
  }
  const store = new SyncStore(join(root, 'sync.db'))
  const registration = store.register({
    localPath: source,
    origin: 'https://app.teler.ai',
    accountId: 'user',
    organizationId: 'org',
    destination: '/personal/reports',
  })
  return { root, store, registration }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function remote(fail: (call: number) => unknown): SyncRemote & { calls: number } {
  const result = {
    calls: 0,
    accountId: async () => 'user',
    async transfer() {
      result.calls++
      const error = fail(result.calls)
      if (error) throw error
      return { status: 'ready' as const, jobId: 'job', revision: 'revision' }
    },
  }
  return result
}

test('a rate limit pauses every upload start until Retry-After, without growing backoff', async () => {
  const f = await fixture(3)
  const limited = remote(() => new ApiError('Too many', 429, 'RATE_LIMITED', 30_000))
  const before = Date.now()
  await reconcile(f.store, f.registration.id, limited, join(f.root, 'snapshots'), 0)
  // The server counts every attempt against the limit: stop at the first refusal.
  expect(limited.calls).toBe(1)
  const until = f.store.throttledUntil()
  expect(until).toBeGreaterThanOrEqual(before + 30_000)
  const refused = f.store.files(f.registration.id).find((file) => file.status === 'retrying')
  expect(refused).toMatchObject({ attempts: 0, error: 'RATE_LIMITED', retryAt: until })

  // While throttled, a new pass starts nothing.
  await reconcile(f.store, f.registration.id, limited, join(f.root, 'snapshots'), 0)
  expect(limited.calls).toBe(1)
  f.store.close()
})

test('the throttle lasts the whole Retry-After the server sends', async () => {
  const f = await fixture(2)
  const remote = createSyncRemote('https://app.teler.ai', {
    env: { TELER_TOKEN: 'test-token' },
    fetch: async (input) => {
      const url = new URL(input)
      if (url.pathname === '/api/teler-cli/me')
        return Response.json({ user: { id: 'user', name: null }, activeOrganizationId: 'org' })
      return Response.json(
        { error: 'Too many requests', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': '300' } }
      )
    },
  })
  const before = Date.now()
  await reconcile(f.store, f.registration.id, remote, join(f.root, 'snapshots'), 0)
  // Not capped at a few seconds: the server's window only drains if nothing is sent.
  expect(f.store.throttledUntil()).toBeGreaterThanOrEqual(before + 300_000)
  f.store.close()
})

test('retries inside one upload command still wait at most five seconds', () => {
  expect(uploadRetryDelay(new ApiError('Too many', 429, 'RATE_LIMITED', 300_000))).toBe(5_000)
  expect(uploadRetryDelay(new ApiError('Too many', 429, 'RATE_LIMITED', 2_000))).toBe(2_000)
})

test('a rate limit leaves uploads that already started to finish', async () => {
  const f = await fixture(2)
  await reconcile(
    f.store,
    f.registration.id,
    remote((call) => (call === 1 ? null : new ApiError('Too many', 429, 'RATE_LIMITED', 60_000))),
    join(f.root, 'snapshots'),
    0
  )
  // One file uploaded, the other was refused and is waiting.
  const files = f.store.files(f.registration.id)
  expect(files.filter((file) => file.status === 'ready')).toHaveLength(1)
  // A started upload (it has a job) is not held back by the throttle.
  const waiting = files.find((file) => file.status === 'retrying')!
  f.store.saveFile({ ...waiting, jobId: 'job-started', status: 'processing', retryAt: 0 })
  const finishing = remote(() => null)
  await reconcile(f.store, f.registration.id, finishing, join(f.root, 'snapshots'), 0)
  expect(finishing.calls).toBe(1)
  f.store.close()
})

test('a shorter Retry-After never shortens a throttle', async () => {
  const f = await fixture(1)
  const later = Date.now() + 200_000
  f.store.throttle(later)
  f.store.throttle(Date.now() + 10_000)
  expect(f.store.throttledUntil()).toBe(later)
  f.store.close()
})

test('a rate limit without Retry-After waits a minute', async () => {
  const f = await fixture(1)
  const before = Date.now()
  await reconcile(
    f.store,
    f.registration.id,
    remote(() => new ApiError('Too many', 429)),
    join(f.root, 'snapshots'),
    0
  )
  expect(f.store.throttledUntil()).toBeGreaterThanOrEqual(before + 60_000)
  f.store.close()
})

test('retrying files keep a safe error code, cleared when they upload', async () => {
  const f = await fixture(1)
  const errors: unknown[] = [
    new ApiError('Upload storage unavailable', 501, 'UPLOAD_NOT_CONFIGURED'),
    // A code that is not a plain constant is reduced to its status.
    new ApiError('Boom', 503, 'see https://evil.example/<script>'),
    new TypeError('fetch failed'),
  ]
  const expected = ['UPLOAD_NOT_CONFIGURED', 'HTTP_503', 'NETWORK']
  for (const [index, error] of errors.entries()) {
    const [file] = f.store.files(f.registration.id)
    if (file) f.store.saveFile({ ...file, retryAt: 0 })
    await reconcile(
      f.store,
      f.registration.id,
      remote(() => error),
      join(f.root, 'snapshots'),
      0
    )
    expect(f.store.files(f.registration.id)[0]).toMatchObject({
      status: 'retrying',
      error: expected[index],
    })
  }
  const [file] = f.store.files(f.registration.id)
  f.store.saveFile({ ...file!, retryAt: 0 })
  await reconcile(
    f.store,
    f.registration.id,
    remote(() => null),
    join(f.root, 'snapshots'),
    0
  )
  expect(f.store.files(f.registration.id)[0]).toMatchObject({ status: 'ready', error: null })
  f.store.close()
})

test('sync retry clears the backoff of retrying files, and status reports the throttle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-retry-'))
  roots.push(root)
  const env = { XDG_STATE_HOME: root }
  const store = new SyncStore(join(syncDirectory(env), 'sync.db'))
  const registration = store.register({
    localPath: join(root, 'missing'),
    origin: 'https://app.teler.ai',
    accountId: 'user',
    organizationId: 'org',
    destination: '/personal/reports',
  })
  store.saveFile({
    registrationId: registration.id,
    relativePath: 'data.csv',
    hash: null,
    revision: null,
    pendingHash: 'hash',
    requestId: 'request',
    jobId: null,
    snapshotPath: null,
    status: 'retrying',
    attempts: 6,
    retryAt: Date.now() + 200_000,
    error: 'HTTP_503',
  })
  store.throttle(Date.now() + 45_000)
  store.close()
  let output = ''
  const deps = {
    env,
    writeOut: (text: string) => {
      output += text
    },
    writeErr: () => undefined,
  }
  expect(await main(['sync', 'retry', registration.id, '--json'], deps)).toBe(0)
  output = ''
  expect(await main(['sync', 'status', '--json'], deps)).toBe(0)
  const status = JSON.parse(output)
  expect(status.throttledUntil).toBeGreaterThan(Date.now())
  expect(status.registrations[0].files[0]).toMatchObject({ retryAt: 0, error: 'HTTP_503' })
})
