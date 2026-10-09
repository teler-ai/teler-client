import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SyncStore } from '../src/sync-store'
import { reconcile } from '../src/sync-engine'
import { scanFolder } from '../src/sync-scan'
import { protectedSyncPaths } from '../src/sync-paths'
import { ApiError } from '../src/errors'
import { main } from '../src/index'
import type { SyncRemote } from '../src/sync-types'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sync-recovery-'))
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'data.csv'), 'a\n1\n')
  const store = new SyncStore(join(root, 'sync.db'))
  const registration = store.register({
    localPath: source,
    origin: 'https://app.teler.ai',
    accountId: 'user',
    organizationId: 'org',
    destination: '/personal/reports',
  })
  return { root, source, store, registration }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('restart finishes immutable pending bytes before ingesting a subsequent local edit', async () => {
  const f = await fixture()
  const calls: string[] = []
  let pending = true
  const remote: SyncRemote = {
    accountId: async () => 'user',
    async transfer(_registration, file, bytes, save) {
      calls.push(await bytes.text())
      save('job')
      if (pending) return { status: 'pending', jobId: 'job' }
      expect(file.jobId).toBe('job')
      return { status: 'ready', revision: 'revision' }
    },
  }
  await reconcile(f.store, f.registration.id, remote, join(f.root, 'snapshots'), 0)
  f.store.close()
  await writeFile(join(f.source, 'data.csv'), 'a\n2\n')
  const reopened = new SyncStore(join(f.root, 'sync.db'))
  pending = false
  await reconcile(reopened, f.registration.id, remote, join(f.root, 'snapshots'), 0)
  expect(calls).toEqual(['a\n1\n', 'a\n1\n'])
  expect(reopened.files(f.registration.id)[0]?.pendingHash).toBeNull()
  reopened.close()
})

test('failed processing and conflicts keep the last ready revision; permanent failures do not loop', async () => {
  const f = await fixture()
  let calls = 0
  const remote: SyncRemote = {
    accountId: async () => 'user',
    transfer: async () => {
      calls++
      return { status: 'ready', revision: 'good' }
    },
  }
  await reconcile(f.store, f.registration.id, remote, join(f.root, 'snapshots'), 0)
  await writeFile(join(f.source, 'data.csv'), 'bad bytes')
  remote.transfer = async () => {
    calls++
    throw new ApiError('Unsupported', 415)
  }
  await reconcile(f.store, f.registration.id, remote, join(f.root, 'snapshots'), 0)
  await reconcile(f.store, f.registration.id, remote, join(f.root, 'snapshots'), 0)
  expect(calls).toBe(2)
  expect(f.store.files(f.registration.id)[0]?.revision).toBe('good')
  expect(f.store.files(f.registration.id)[0]?.status).toBe('failed')
  f.store.close()
})

test('one owner coordinates all registrations and stale owners cannot renew', async () => {
  const f = await fixture()
  const second = new SyncStore(join(f.root, 'sync.db'))
  expect(f.store.acquire('one')).toBe(true)
  expect(second.acquire('two')).toBe(false)
  f.store.release('one')
  expect(second.acquire('two')).toBe(true)
  f.store.renew('one')
  expect(f.store.owns('one')).toBe(false)
  expect(second.owns('two')).toBe(true)
  second.close()
  f.store.close()
})

test('symlinked ignore files fail closed and external directory symlinks are skipped', async () => {
  const f = await fixture()
  await symlink(f.root, join(f.source, 'external'))
  const scan = await scanFolder(f.source, 0)
  expect(scan.skipped).toContainEqual({ relativePath: 'external', reason: 'symlink' })
  await symlink(join(f.source, 'data.csv'), join(f.source, '.telerignore'))
  await expect(scanFolder(f.source, 0)).rejects.toThrow('ignore file')
  f.store.close()
})

test('dry-run needs no credentials or state writes and management works offline', async () => {
  const f = await fixture()
  f.store.close()
  const env = { XDG_STATE_HOME: join(f.root, 'state') }
  let output = ''
  const deps = {
    env,
    writeOut: (text: string) => {
      output += text
    },
    writeErr: () => undefined,
    fetch: async () => {
      throw new Error('Must stay offline')
    },
  }
  expect(
    await main(['sync', f.source, '--to', '/personal/reports', '--dry-run', '--json'], deps)
  ).toBe(0)
  expect(JSON.parse(output).files).toHaveLength(1)
  expect(await Bun.file(join(f.root, 'state', 'teler', 'sync', 'sync.db')).exists()).toBe(false)
  expect(await main(['sync', 'list', '--json'], deps)).toBe(0)
})

test('corrected content starts a new job after a terminal processing failure', async () => {
  const f = await fixture()
  let calls = 0
  let previousRequest: string | null = null
  const remote: SyncRemote = {
    accountId: async () => 'user',
    async transfer(_registration, file, _bytes, save) {
      calls++
      if (calls === 1) {
        previousRequest = file.requestId
        save('failed-job')
        return { status: 'failed', jobId: 'failed-job' }
      }
      expect(file.jobId).toBeNull()
      expect(file.requestId).not.toBe(previousRequest)
      return { status: 'ready', revision: 'fixed' }
    },
  }
  await reconcile(f.store, f.registration.id, remote, join(f.root, 'snapshots'), 0)
  await writeFile(join(f.source, 'data.csv'), 'a\n2\n')
  await reconcile(f.store, f.registration.id, remote, join(f.root, 'snapshots'), 0)
  expect(calls).toBe(2)
  expect(f.store.files(f.registration.id)[0]?.revision).toBe('fixed')
  f.store.close()
})

test('temporary upload setup conflicts remain retryable', async () => {
  const f = await fixture()
  const remote: SyncRemote = {
    accountId: async () => 'user',
    transfer: async () => {
      throw new ApiError('Busy', 409, 'UPLOAD_SETUP_IN_PROGRESS')
    },
  }
  await reconcile(f.store, f.registration.id, remote, join(f.root, 'snapshots'), 0)
  expect(f.store.files(f.registration.id)[0]?.status).toBe('retrying')
  f.store.close()
})

test('configured CLI credentials and sync state are excluded even as the tracked root', async () => {
  const f = await fixture()
  const credentials = join(f.source, '.config', 'teler', 'credentials')
  await mkdir(credentials, { recursive: true })
  await writeFile(join(credentials, 'origin-hash.json'), '{"token":"do-not-upload"}')
  const state = join(f.source, 'state')
  await mkdir(state)
  await writeFile(join(state, 'snapshot.csv'), 'private')
  const result = await scanFolder(f.source, 0, [credentials, state])
  expect(result.files.map((file) => file.relativePath)).toEqual(['data.csv'])
  expect((await scanFolder(credentials, 0, [credentials, state])).files).toHaveLength(0)
  f.store.close()
})

test('default CLI credentials and sync state stay excluded when an embedder moves XDG directories', async () => {
  const f = await fixture()
  // The synced folder is the home folder of a user who also runs the CLI.
  const credentials = join(f.source, '.config', 'teler', 'credentials')
  await mkdir(credentials, { recursive: true })
  await writeFile(join(credentials, 'origin-hash.json'), '{"token":"do-not-upload"}')
  const state = join(f.source, '.local', 'state', 'teler', 'sync')
  await mkdir(state, { recursive: true })
  await writeFile(join(state, 'snapshot.csv'), 'private')
  const embedded = {
    XDG_CONFIG_HOME: join(f.root, 'app', 'config'),
    XDG_STATE_HOME: join(f.root, 'app', 'state'),
  }
  const result = await scanFolder(f.source, 0, protectedSyncPaths(embedded, f.source))
  expect(result.files.map((file) => file.relativePath)).toEqual(['data.csv'])
  f.store.close()
})

test('expired staging restarts its request while preserving the canonical revision and snapshot', async () => {
  const f = await fixture()
  let originalRequest: string | null = null
  const remote: SyncRemote = {
    accountId: async () => 'user',
    async transfer(_registration, file, _bytes, save) {
      originalRequest = file.requestId
      save('expired-job')
      throw new ApiError('Stage expired', 409, 'SYNC_STAGE_EXPIRED')
    },
  }
  await reconcile(f.store, f.registration.id, remote, join(f.root, 'snapshots'), 0)
  const pending = f.store.files(f.registration.id)[0]
  expect(pending?.status).toBe('pending')
  expect(pending?.requestId).not.toBe(originalRequest)
  expect(pending?.jobId).toBeNull()
  expect(pending?.revision).toBeNull()
  expect(await Bun.file(pending?.snapshotPath ?? '').text()).toBe('a\n1\n')
  f.store.close()
})

test('stop requests target the current worker and preserve registrations', async () => {
  const f = await fixture()
  expect(f.store.acquire('worker')).toBe(true)
  expect(f.store.requestStop()).toBe('worker')
  expect(f.store.stopRequested('worker')).toBe(true)
  expect(f.store.stopRequested('new-worker')).toBe(false)
  f.store.release('worker')
  expect(f.store.list()).toHaveLength(1)
  expect(f.store.acquire('new-worker')).toBe(true)
  expect(f.store.stopRequested('new-worker')).toBe(false)
  f.store.close()
})

test('a temporarily unready file is retried without becoming a conflict', async () => {
  const f = await fixture()
  const remote: SyncRemote = {
    accountId: async () => 'user',
    transfer: async () => {
      throw new ApiError('Not ready', 409, 'SYNC_NOT_READY')
    },
  }
  await reconcile(f.store, f.registration.id, remote, join(f.root, 'snapshots'), 0)
  expect(f.store.files(f.registration.id)[0]?.status).toBe('retrying')
  f.store.close()
})
