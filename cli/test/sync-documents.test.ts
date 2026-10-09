import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptySyncFile, reconcile } from '../src/sync-engine'
import { createSyncRemote } from '../src/sync-remote'
import { SyncStore } from '../src/sync-store'
import type { SyncRegistration, SyncRemote } from '../src/sync-types'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('the commit reports the Teler documents of a synced file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-documents-'))
  roots.push(root)
  await writeFile(join(root, 'data.csv'), 'a\n1\n')
  const registration: SyncRegistration = {
    id: 'source-id',
    localPath: root,
    origin: 'https://app.teler.ai',
    accountId: 'user',
    organizationId: 'org',
    destination: '/personal/reports',
    paused: false,
    status: 'pending',
    checkedAt: null,
  }
  const remote = createSyncRemote(registration.origin, {
    env: { TELER_TOKEN: 'test-token' },
    fetch: async (input) => {
      const path = new URL(input).pathname
      if (path === '/api/teler-cli/me')
        return Response.json({ user: { id: 'user', name: null }, activeOrganizationId: 'org' })
      if (path === '/api/uploads/sync') return Response.json({ jobId: 'job', status: 'processing' })
      if (path === '/api/uploads/job') return Response.json({ status: 'completed' })
      return Response.json({ revision: 'revision', documentIds: ['doc_one'] })
    },
  })
  await remote.accountId()
  const file = { ...emptySyncFile(registration.id, 'data.csv'), pendingHash: 'hash' }
  expect(
    await remote.transfer(registration, file, Bun.file(join(root, 'data.csv')), () => undefined)
  ).toEqual({ status: 'ready', jobId: 'job', revision: 'revision', documentIds: ['doc_one'] })
})

test('a synced file keeps its document ids, so the app can open it in Teler', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-documents-'))
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'data.csv'), 'a\n1\n')
  await utimes(join(source, 'data.csv'), new Date(0), new Date(0))
  const store = new SyncStore(join(root, 'sync.db'))
  const registration = store.register({
    localPath: source,
    origin: 'https://app.teler.ai',
    accountId: 'user',
    organizationId: 'org',
    destination: '/personal/reports',
  })
  const remote: SyncRemote = {
    accountId: async () => 'user',
    transfer: async () => ({
      status: 'ready',
      jobId: 'job',
      revision: 'revision',
      documentIds: ['doc_one'],
    }),
  }
  await reconcile(store, registration.id, remote, join(root, 'snapshots'), 0)
  expect(store.files(registration.id)[0]).toMatchObject({
    status: 'ready',
    documentIds: ['doc_one'],
  })
  store.close()
})
