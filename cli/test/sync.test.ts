import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SyncStore } from '../src/sync-store'
import { scanFolder } from '../src/sync-scan'

const roots: string[] = []
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'teler-sync-test-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('registrations are idempotent and durable; remove retains unrelated registrations', async () => {
  const path = join(await temporary(), 'sync.db')
  const identity = {
    localPath: '/reports',
    origin: 'https://app.teler.ai',
    accountId: 'user',
    organizationId: 'org',
    destination: '/personal/reports',
  }
  let store = new SyncStore(path)
  const first = store.register(identity)
  expect(store.register(identity).id).toBe(first.id)
  expect(store.register({ ...identity, accountId: 'other' }).id).not.toBe(first.id)
  store.close()
  store = new SyncStore(path)
  expect(store.list()).toHaveLength(2)
  store.remove(first.id)
  expect(store.list()).toHaveLength(1)
  store.close()
})

test('recursive scan excludes secrets, ignored paths and symlinks with visible reasons', async () => {
  const root = await temporary()
  await mkdir(join(root, 'nested'))
  await writeFile(join(root, 'nested', 'data.csv'), 'a\n1\n')
  await writeFile(join(root, '.env'), 'secret')
  await writeFile(join(root, 'private.csv'), 'private')
  await writeFile(join(root, '.telerignore'), 'private.csv\n')
  await symlink(join(root, 'nested', 'data.csv'), join(root, 'link.csv'))
  const result = await scanFolder(root, 0)
  expect(result.files.map((file) => file.relativePath)).toEqual(['nested/data.csv'])
  expect(result.skipped.map((file) => file.reason)).toContain('symlink')
  expect(result.skipped.filter((file) => file.reason === 'excluded').length).toBeGreaterThanOrEqual(
    3
  )
})

test('reconciliation persists pending jobs and never redirects a registered account', async () => {
  const { reconcile } = await import('../src/sync-engine')
  const root = await temporary()
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'data.csv'), 'a\n1\n')
  const store = new SyncStore(join(root, 'state', 'sync.db'))
  const registration = store.register({
    localPath: source,
    origin: 'https://app.teler.ai',
    accountId: 'user',
    organizationId: 'org',
    destination: '/personal/reports',
  })
  let transfers = 0
  const remote = {
    accountId: async () => 'other',
    transfer: async () => {
      transfers++
      return { status: 'ready' as const, revision: 'revision' }
    },
  }
  await reconcile(store, registration.id, remote, join(root, 'snapshots'), 0)
  expect(transfers).toBe(0)
  expect(store.get(registration.id)?.status).toBe('authentication-required')
  remote.accountId = async () => 'user'
  await reconcile(store, registration.id, remote, join(root, 'snapshots'), 0)
  await reconcile(store, registration.id, remote, join(root, 'snapshots'), 0)
  expect(transfers).toBe(1)
  expect(store.files(registration.id)[0]?.revision).toBe('revision')
  await rm(source, { recursive: true })
  await reconcile(store, registration.id, remote, join(root, 'snapshots'), 0)
  expect(store.get(registration.id)?.status).toBe('root-unavailable')
  expect(store.files(registration.id)[0]?.revision).toBe('revision')
  store.close()
})
