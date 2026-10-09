import { afterEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSyncWorker } from '../src/sync-daemon'
import { emptySyncFile } from '../src/sync-engine'
import { syncDirectory } from '../src/sync-paths'
import { SyncStore } from '../src/sync-store'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

// A worker that starts with a renewed credential (Teler Desktop restarts its
// daemon after reconnecting) must retry authentication failures at once
// instead of waiting out a backoff of up to five minutes.
test('clearing authentication backoff retries only authentication failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'teler-sync-reauth-'))
  roots.push(root)
  const store = new SyncStore(join(root, 'sync.db'))
  try {
    const registration = store.register({
      localPath: '/reports',
      origin: 'https://app.teler.ai',
      accountId: 'user',
      organizationId: 'org',
      destination: '/personal/reports',
    })
    const later = Date.now() + 300_000
    store.saveFile({
      ...emptySyncFile(registration.id, 'denied.csv'),
      status: 'authentication-required',
      attempts: 8,
      retryAt: later,
    })
    store.saveFile({
      ...emptySyncFile(registration.id, 'flaky.csv'),
      status: 'retrying',
      attempts: 3,
      retryAt: later,
    })

    store.clearAuthenticationBackoff()

    const files = Object.fromEntries(
      store.files(registration.id).map((file) => [file.relativePath, file])
    )
    expect(files['denied.csv']).toMatchObject({ status: 'authentication-required', retryAt: 0 })
    expect(files['flaky.csv']).toMatchObject({ status: 'retrying', retryAt: later })
  } finally {
    store.close()
  }
})

test('a worker that fails while clearing authentication backoff releases its lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'teler-sync-reauth-'))
  roots.push(root)
  const env = { XDG_STATE_HOME: root }
  const clear = spyOn(SyncStore.prototype, 'clearAuthenticationBackoff').mockImplementation(() => {
    throw new Error('disk I/O error')
  })
  try {
    await expect(runSyncWorker({ env })).rejects.toThrow('disk I/O error')
  } finally {
    clear.mockRestore()
  }
  const store = new SyncStore(join(syncDirectory(env), 'sync.db'))
  try {
    expect(store.running()).toBe(false)
  } finally {
    store.close()
  }
})
