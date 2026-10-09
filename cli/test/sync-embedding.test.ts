import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { SyncStore } from '../src/sync-store'

// Teler Desktop embeds this CLI as a compiled sidecar and supervises its
// daemon. These tests pin the contracts that embedding relies on.

const requestSchema = z.object({ clientRequestId: z.string() })
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function eventually(check: () => boolean, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Sync did not reach the expected state')
    await Bun.sleep(50)
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'teler-sync-embedding-'))
  const jobs = new Set<string>()
  const accessTokens: Array<string | null> = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      accessTokens.push(request.headers.get('cf-access-token'))
      if (path === '/api/teler-cli/me') {
        return Response.json({ user: { id: 'user_test', name: null }, activeOrganizationId: 'org' })
      }
      if (path === '/api/uploads/sync') {
        const { clientRequestId } = requestSchema.parse(await request.json())
        jobs.add(clientRequestId)
        return Response.json({
          jobId: clientRequestId,
          status: 'uploading',
          partCount: 1,
          partSizeBytes: 1024,
        })
      }
      if (path.endsWith('/commit')) {
        return Response.json({ revision: 'b'.repeat(64), documentIds: ['doc_test'] })
      }
      const jobId = path.match(/^\/api\/uploads\/([^/]+)/)?.[1] ?? ''
      if (path.includes('/parts/')) {
        const bytes = await request.arrayBuffer()
        if (Number(request.headers.get('Content-Length')) !== bytes.byteLength) {
          return Response.json({ code: 'PART_SIZE_MISMATCH' }, { status: 400 })
        }
        return Response.json({ ok: true })
      }
      if (path.endsWith('/complete')) return Response.json({ jobId, status: 'completed' })
      return Response.json({ status: jobs.has(jobId) ? 'completed' : 'uploading' })
    },
  })
  const folder = join(root, 'reports')
  await mkdir(folder)
  await writeFile(join(folder, 'data.csv'), 'value\n1\n')
  await utimes(join(folder, 'data.csv'), new Date(0), new Date(0))
  const env: Record<string, string | undefined> = {
    ...process.env,
    XDG_STATE_HOME: join(root, 'state'),
    TELER_URL: server.url.origin,
    TELER_TOKEN: 'test-only-token',
  }
  const store = () => new SyncStore(join(root, 'state', 'teler', 'sync', 'sync.db'))
  cleanups.push(async () => {
    await server.stop(true)
    await rm(root, { recursive: true, force: true })
  })
  return { root, folder, env, jobs, store, accessTokens }
}

async function run(command: string[], env: Record<string, string | undefined>) {
  const child = Bun.spawn(command, { env, stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

async function stopDaemon(cli: string[], env: Record<string, string | undefined>) {
  await run([...cli, 'sync', 'stop'], env)
}

const sourceCli = [process.execPath, fileURLToPath(new URL('../src/index.ts', import.meta.url))]

test('a compiled CLI binary starts the background daemon for a new registration', async () => {
  const { root, folder, env, store } = await fixture()
  const binary = join(root, process.platform === 'win32' ? 'teler.exe' : 'teler')
  const build = await run(
    [process.execPath, 'build', '--compile', sourceCli[1]!, '--outfile', binary],
    process.env
  )
  expect(build.exitCode).toBe(0)
  cleanups.push(() => stopDaemon([binary], env))

  const registered = await run([binary, 'sync', folder, '--to', '/personal/reports', '--json'], env)
  expect(registered.stderr).toBe('')
  expect(registered.exitCode).toBe(0)
  const { id } = z.object({ id: z.string() }).parse(JSON.parse(registered.stdout))

  const state = store()
  try {
    await eventually(() => state.files(id)[0]?.status === 'ready')
  } finally {
    state.close()
  }
}, 60_000)

test('managed mode registers folders without starting a detached daemon', async () => {
  const { folder, env, store } = await fixture()
  const managed = { ...env, TELER_SYNC_DAEMON: 'managed' }
  cleanups.push(() => stopDaemon(sourceCli, managed))

  const registered = await run(
    [...sourceCli, 'sync', folder, '--to', '/personal/reports', '--json'],
    managed
  )
  expect(registered.exitCode).toBe(0)
  const resumed = await run([...sourceCli, 'sync', 'list', '--json'], managed)
  expect(JSON.parse(resumed.stdout)).toMatchObject({ daemonRunning: false })

  // Give a wrongly detached daemon time to acquire its lease before asserting.
  await Bun.sleep(1_500)
  const state = store()
  try {
    expect(state.running()).toBe(false)
    expect(state.list()).toHaveLength(1)
  } finally {
    state.close()
  }
}, 30_000)

test('an environment token syncs without creating an OS credential store', async () => {
  const { folder, env, store, accessTokens } = await fixture()
  // An invalid store selection stands in for platforms without a supported
  // OS credential store (Windows): the environment token must be sufficient.
  // The Access token stands in for Teler Desktop on an Access-protected origin.
  const tokenOnly = {
    ...env,
    TELER_CREDENTIAL_STORE: 'unsupported',
    TELER_SYNC_DAEMON: 'managed',
    TELER_ACCESS_TOKEN: 'access-test-token',
  }
  cleanups.push(() => stopDaemon(sourceCli, tokenOnly))

  const registered = await run(
    [...sourceCli, 'sync', folder, '--to', '/personal/reports', '--json'],
    tokenOnly
  )
  expect(registered.stderr).toBe('')
  expect(registered.exitCode).toBe(0)
  const { id } = z.object({ id: z.string() }).parse(JSON.parse(registered.stdout))

  const daemon = Bun.spawn([...sourceCli, 'sync', 'daemon'], {
    env: tokenOnly,
    stdout: 'ignore',
    stderr: 'ignore',
  })
  cleanups.push(async () => {
    daemon.kill('SIGTERM')
    await daemon.exited
  })
  const state = store()
  try {
    // The daemon marks the file ready first, then the folder.
    await eventually(
      () => state.files(id)[0]?.status === 'ready' && state.get(id)?.status === 'ready'
    )
    // Registration and every daemon request (account, upload, parts, commit) passed Access.
    expect(accessTokens.length).toBeGreaterThan(3)
    expect(new Set(accessTokens)).toEqual(new Set(['access-test-token']))
  } finally {
    state.close()
  }
}, 30_000)
