import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSyncRemote } from '../src/sync-remote'
import { emptySyncFile } from '../src/sync-engine'
import type { SyncRegistration } from '../src/sync-types'

const registration: SyncRegistration = {
  id: 'source-id',
  localPath: '/tmp/source',
  origin: 'https://app.teler.ai',
  accountId: 'user',
  organizationId: 'pinned-org',
  destination: '/personal/reports',
  paused: false,
  status: 'pending',
  checkedAt: null,
}

test('sync transport preserves metadata across staging and commit and sends parts with their exact length', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-transport-'))
  try {
    const path = join(root, 'data.csv')
    await writeFile(path, 'a\n1\n')
    const metadata: unknown[] = []
    let part = ''
    const remote = createSyncRemote(registration.origin, {
      env: { TELER_TOKEN: 'test-token' },
      fetch: async (input, init) => {
        const url = new URL(input)
        if (url.pathname === '/api/teler-cli/me')
          return Response.json({
            user: { id: 'user', name: null },
            activeOrganizationId: 'different-org',
          })
        if (url.pathname === '/api/uploads/sync') {
          metadata.push(JSON.parse(String(init?.body)))
          return Response.json({
            jobId: 'job',
            status: 'uploading',
            partCount: 1,
            partSizeBytes: 100,
          })
        }
        if (url.pathname.endsWith('/parts/1')) {
          expect(new Headers(init?.headers).get('Content-Length')).toBe('4')
          part = await new Response(init?.body).text()
          return Response.json({})
        }
        if (url.pathname.endsWith('/complete'))
          return Response.json({ jobId: 'job', status: 'completed' })
        if (url.pathname === '/api/uploads/job') return Response.json({ status: 'completed' })
        if (url.pathname.endsWith('/commit')) {
          metadata.push(JSON.parse(String(init?.body)))
          return Response.json({ revision: 'new', documentIds: ['stable-id'] })
        }
        throw new Error('Unexpected request')
      },
    })
    await remote.accountId()
    const file = {
      ...emptySyncFile(registration.id, 'nested/data.csv'),
      pendingHash: 'hash',
      revision: 'previous',
      requestId: 'persistent-request',
    }
    const result = await remote.transfer(registration, file, Bun.file(path), () => undefined)
    expect(result).toEqual({
      status: 'ready',
      jobId: 'job',
      revision: 'new',
      documentIds: ['stable-id'],
    })
    expect(part).toBe('a\n1\n')
    expect(metadata[0]).toEqual(metadata[1])
    expect(metadata[0]).toMatchObject({
      organizationId: 'pinned-org',
      destinationPath: '/personal/reports/nested',
      expectedRevision: 'previous',
      clientRequestId: 'persistent-request',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('environment token is never sent to a different registered origin', async () => {
  let networkCalls = 0
  const remote = createSyncRemote('https://other.teler.example', {
    env: { TELER_TOKEN: 'sensitive', TELER_URL: 'https://app.teler.ai' },
    store: { get: async () => null, set: async () => undefined, delete: async () => undefined },
    fetch: async () => {
      networkCalls++
      throw new Error('Unexpected request')
    },
  })
  await expect(remote.accountId()).rejects.toThrow('authentication required')
  expect(networkCalls).toBe(0)
})

test('saved queued jobs poll status without allocating again and commit after completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-poll-'))
  try {
    const path = join(root, 'data.csv')
    await writeFile(path, 'a\n1\n')
    let prepareCalls = 0
    let commits = 0
    let jobStatus = 'queued'
    const remote = createSyncRemote(registration.origin, {
      env: { TELER_TOKEN: 'test-token' },
      fetch: async (input) => {
        const endpoint = new URL(input).pathname
        if (endpoint === '/api/teler-cli/me')
          return Response.json({ user: { id: 'user', name: null }, activeOrganizationId: 'org' })
        if (endpoint === '/api/uploads/sync') {
          prepareCalls++
          return Response.json({ jobId: 'saved-job', status: 'processing' })
        }
        if (endpoint === '/api/uploads/saved-job') return Response.json({ status: jobStatus })
        if (endpoint.endsWith('/commit')) {
          commits++
          return Response.json({ revision: 'ready-revision', documentIds: [] })
        }
        throw new Error('Unexpected endpoint')
      },
    })
    await remote.accountId()
    const file = {
      ...emptySyncFile(registration.id, 'data.csv'),
      pendingHash: 'hash',
      requestId: 'persistent',
    }
    const save = (jobId: string) => {
      file.jobId = jobId
    }
    expect((await remote.transfer(registration, file, Bun.file(path), save)).status).toBe('pending')
    jobStatus = 'processing'
    expect((await remote.transfer(registration, file, Bun.file(path), save)).status).toBe('pending')
    jobStatus = 'completed'
    expect((await remote.transfer(registration, file, Bun.file(path), save)).status).toBe('ready')
    expect(prepareCalls).toBe(1)
    expect(commits).toBe(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('missing saved jobs use expired-stage recovery without allocating in the polling request', async () => {
  let prepareCalls = 0
  const remote = createSyncRemote(registration.origin, {
    env: { TELER_TOKEN: 'test-token' },
    fetch: async (input) => {
      const endpoint = new URL(input).pathname
      if (endpoint === '/api/teler-cli/me')
        return Response.json({ user: { id: 'user', name: null }, activeOrganizationId: 'org' })
      if (endpoint === '/api/uploads/sync') prepareCalls++
      return Response.json({ code: 'NOT_FOUND' }, { status: 404 })
    },
  })
  await remote.accountId()
  const file = {
    ...emptySyncFile(registration.id, 'data.csv'),
    jobId: 'missing',
    pendingHash: 'hash',
  }
  await expect(
    remote.transfer(registration, file, Bun.file(import.meta.path), () => undefined)
  ).rejects.toMatchObject({ code: 'SYNC_STAGE_EXPIRED' })
  expect(prepareCalls).toBe(0)
})

test('saved uploading jobs fetch their multipart plan while failed jobs stay terminal', async () => {
  let prepareCalls = 0
  let status = 'uploading'
  const remote = createSyncRemote(registration.origin, {
    env: { TELER_TOKEN: 'test-token' },
    fetch: async (input) => {
      const endpoint = new URL(input).pathname
      if (endpoint === '/api/teler-cli/me')
        return Response.json({ user: { id: 'user', name: null }, activeOrganizationId: 'org' })
      if (endpoint === '/api/uploads/sync') {
        prepareCalls++
        status = 'queued'
        return Response.json({ jobId: 'saved', status: 'processing' })
      }
      if (endpoint === '/api/uploads/saved') return Response.json({ status })
      throw new Error('Unexpected endpoint')
    },
  })
  await remote.accountId()
  const file = {
    ...emptySyncFile(registration.id, 'data.csv'),
    jobId: 'saved',
    pendingHash: 'hash',
  }
  expect(
    (await remote.transfer(registration, file, Bun.file(import.meta.path), () => undefined)).status
  ).toBe('pending')
  status = 'failed'
  expect(
    (await remote.transfer(registration, file, Bun.file(import.meta.path), () => undefined)).status
  ).toBe('failed')
  expect(prepareCalls).toBe(1)
})
