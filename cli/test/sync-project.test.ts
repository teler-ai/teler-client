import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/index'
import { syncDirectory } from '../src/sync-paths'
import { createSyncRemote } from '../src/sync-remote'
import { emptySyncFile } from '../src/sync-engine'
import { SyncStore } from '../src/sync-store'
import type { SyncRegistration } from '../src/sync-types'

const PROJECT = 'prj_01h455vb4pex5vsknk084sn02q'
const roots: string[] = []
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'teler-sync-project-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const identity = {
  localPath: '/reports',
  origin: 'https://app.teler.ai',
  accountId: 'user',
  organizationId: 'org',
  destination: '/personal/reports',
}

test('a project makes a separate registration and keeps registrations made before projects', async () => {
  const path = join(await temporary(), 'sync.db')
  new SyncStore(path).close()
  // A registration saved by a CLI version without projects.
  const legacy = new Database(path)
  legacy
    .query('INSERT INTO registrations VALUES (?,?,?)')
    .run(
      'legacy-id',
      JSON.stringify(Object.values(identity)),
      JSON.stringify({ ...identity, id: 'legacy-id', paused: false, status: 'ready', checkedAt: 1 })
    )
  legacy.close()
  const store = new SyncStore(path)
  expect(store.register(identity).id).toBe('legacy-id')
  const inProject = store.register({ ...identity, projectId: PROJECT })
  expect(inProject.id).not.toBe('legacy-id')
  expect(inProject.projectId).toBe(PROJECT)
  expect(store.register({ ...identity, projectId: PROJECT }).id).toBe(inProject.id)
  store.close()
})

/** A server that stages, processes and commits one file, recording sync metadata. */
function syncServer(metadata: unknown[]) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.pathname === '/api/teler-cli/me')
      return Response.json({ user: { id: 'user', name: null }, activeOrganizationId: 'org' })
    if (url.pathname === '/api/uploads/sync') {
      metadata.push(JSON.parse(String(init?.body)))
      return Response.json({ jobId: 'job', status: 'processing' })
    }
    if (url.pathname === '/api/uploads/job') return Response.json({ status: 'completed' })
    if (url.pathname === '/api/uploads/sync/job/commit') {
      metadata.push(JSON.parse(String(init?.body)))
      return Response.json({ revision: 'revision', documentIds: ['document'] })
    }
    throw new Error(`Unexpected request ${url.pathname}`)
  }
}

test('sync transport sends the registration project when staging and committing', async () => {
  const root = await temporary()
  await writeFile(join(root, 'data.csv'), 'a\n1\n')
  const metadata: unknown[] = []
  const registration: SyncRegistration = {
    ...identity,
    projectId: PROJECT,
    id: 'source-id',
    paused: false,
    status: 'pending',
    checkedAt: null,
  }
  const remote = createSyncRemote(identity.origin, {
    env: { TELER_TOKEN: 'test-token' },
    fetch: syncServer(metadata),
  })
  await remote.accountId()
  const file = { ...emptySyncFile(registration.id, 'data.csv'), pendingHash: 'hash' }
  expect(
    await remote.transfer(registration, file, Bun.file(join(root, 'data.csv')), () => undefined)
  ).toEqual({ status: 'ready', jobId: 'job', revision: 'revision', documentIds: ['document'] })
  expect(metadata).toHaveLength(2)
  for (const sent of metadata) expect(sent).toMatchObject({ projectId: PROJECT })

  metadata.length = 0
  const { projectId: _projectId, ...withoutProject } = registration
  await remote.transfer(withoutProject, file, Bun.file(join(root, 'data.csv')), () => undefined)
  for (const sent of metadata) expect(sent).not.toHaveProperty('projectId')
})

test('sync --project registers the folder into that project', async () => {
  const root = await temporary()
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'data.csv'), 'a\n1\n')
  const env = { XDG_STATE_HOME: root, TELER_TOKEN: 'test-token' }
  const metadata: unknown[] = []
  let output = ''
  const code = await main(
    ['sync', source, '--to', '/personal/reports', '--project', PROJECT, '--once', '--json'],
    {
      env,
      fetch: syncServer(metadata),
      writeOut: (text) => {
        output += text
      },
      writeErr: () => undefined,
    }
  )
  expect(code).toBe(0)
  expect(JSON.parse(output)).toMatchObject({ projectId: PROJECT, status: 'ready' })
  expect(metadata[0]).toMatchObject({ projectId: PROJECT, organizationId: 'org' })
  const store = new SyncStore(join(syncDirectory(env), 'sync.db'))
  expect(store.list().map((registration) => registration.projectId)).toEqual([PROJECT])
  store.close()
})

test('sync rejects a malformed project id before contacting Teler', async () => {
  const root = await temporary()
  let errors = ''
  const code = await main(['sync', root, '--to', '/personal/reports', '--project', 'reports'], {
    env: { XDG_STATE_HOME: root, TELER_TOKEN: 'test-token' },
    fetch: async () => {
      throw new Error('Must stay offline')
    },
    writeOut: () => undefined,
    writeErr: (text) => {
      errors += text
    },
  })
  expect(code).not.toBe(0)
  expect(errors).toContain('--project')
})
