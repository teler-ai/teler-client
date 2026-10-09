import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { SyncStore } from '../src/sync-store'
import type { SyncRegistration } from '../src/sync-types'

const requestSchema = z.object({
  clientRequestId: z.string(),
  relativePath: z.string(),
  destinationPath: z.string(),
  expectedRevision: z.string().nullable(),
})
interface TestJob {
  input: z.infer<typeof requestSchema>
  status: string
}
async function eventually(check: () => boolean, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Daemon did not reach the expected state')
    await Bun.sleep(50)
  }
}
async function stableFile(path: string, text: string) {
  await writeFile(path, text)
  await utimes(path, new Date(0), new Date(0))
}

test('one daemon reconciles two folders, rejects a second worker, and retains failed refreshes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'teler-sync-process-'))
  const jobs = new Map<string, TestJob>()
  const commits: string[] = []
  const deletes: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (request.method === 'DELETE') deletes.push(path)
      if (path === '/api/teler-cli/me') {
        return Response.json({
          user: { id: 'user_test', name: null },
          activeOrganizationId: 'org_test',
        })
      }
      if (path === '/api/uploads/sync') {
        const input = requestSchema.parse(await request.json())
        const id = input.clientRequestId
        if (!jobs.has(id)) jobs.set(id, { input, status: 'uploading' })
        return Response.json({
          jobId: id,
          status: jobs.get(id)!.status,
          partCount: 1,
          partSizeBytes: 1024,
        })
      }
      const match = path.match(/^\/api\/uploads\/(?:sync\/)?([^/]+)(.*)$/)
      const id = match?.[1] ?? ''
      const job = jobs.get(id)
      if (!job) return Response.json({ code: 'NOT_FOUND' }, { status: 404 })
      if (path.endsWith('/commit')) {
        commits.push(job.input.destinationPath)
        return Response.json({
          status: 'ready',
          revision: 'a'.repeat(64),
          documentIds: ['doc_test'],
        })
      }
      if (path.includes('/parts/')) {
        const bytes = await request.arrayBuffer()
        if (Number(request.headers.get('Content-Length')) !== bytes.byteLength) {
          return Response.json({ code: 'LENGTH_REQUIRED' }, { status: 411 })
        }
        return Response.json({ ok: true })
      }
      if (path.endsWith('/complete')) {
        job.status = job.input.expectedRevision ? 'partial_success' : 'completed'
        return Response.json({ jobId: id, status: job.status })
      }
      return Response.json({ status: job.status })
    },
  })
  const env = {
    ...process.env,
    XDG_STATE_HOME: root,
    TELER_URL: server.url.origin,
    TELER_TOKEN: 'test-only-token',
  }
  const store = new SyncStore(join(root, 'teler', 'sync', 'sync.db'))
  const cli = fileURLToPath(new URL('../src/index.ts', import.meta.url))
  let worker: ReturnType<typeof Bun.spawn> | undefined
  try {
    const registrations: SyncRegistration[] = []
    for (const name of ['reports', 'exports']) {
      const localPath = join(root, name)
      await mkdir(localPath)
      await stableFile(join(localPath, 'data.csv'), 'value\n1\n')
      registrations.push(
        store.register({
          localPath,
          origin: server.url.origin,
          accountId: 'user_test',
          organizationId: 'org_test',
          destination: `/personal/${name}`,
        })
      )
    }
    worker = Bun.spawn([process.execPath, cli, 'sync', 'daemon'], {
      env,
      stdout: 'ignore',
      stderr: 'pipe',
    })
    await eventually(() =>
      registrations.every((registration) => store.files(registration.id)[0]?.status === 'ready')
    )
    expect(commits.sort()).toEqual(['/personal/exports', '/personal/reports'])
    const duplicate = Bun.spawn([process.execPath, cli, 'sync', 'daemon'], {
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await duplicate.exited).toBe(0)
    expect(await new Response(duplicate.stdout).text()).toContain('already running')

    const first = registrations[0]!
    await stableFile(join(first.localPath, 'data.csv'), 'value\n2\n')
    await eventually(() => store.files(first.id)[0]?.status === 'failed')
    expect(store.files(first.id)[0]?.revision).toBe('a'.repeat(64))
    expect(commits).toHaveLength(2)
    await rm(first.localPath, { recursive: true })
    await eventually(() => store.get(first.id)?.status === 'root-unavailable')
    expect(store.files(first.id)[0]?.revision).toBe('a'.repeat(64))
    expect(deletes).toEqual([])
  } finally {
    worker?.kill('SIGTERM')
    if (worker) await worker.exited
    store.close()
    await server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
}, 40_000)
