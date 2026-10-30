#!/usr/bin/env bun
/**
 * Uploads a small file with a `teler` executable to a loopback fake of the
 * upload API and checks that every byte arrived. Compiled Bun 1.3 executables
 * crashed when a request body was a file-backed Blob; `bun test` never runs one.
 *
 *   bun scripts/upload-smoke.ts release/teler-linux-x64
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const executable = process.argv[2]
if (!executable) throw new Error('Usage: bun scripts/upload-smoke.ts <teler-executable>')

// Two parts, both far below the size at which the crash stopped happening.
const content = new TextEncoder().encode('a,b\n1,2\n3,4\n')
const partSizeBytes = 8
const received: number[] = []
let completed = false

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/api/teler-cli/me') return Response.json({ activeOrganizationId: 'org_smoke' })
    if (path === '/api/uploads' && request.method === 'POST') {
      return Response.json({
        jobId: 'job_smoke',
        partSizeBytes,
        partCount: Math.ceil(content.byteLength / partSizeBytes),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
    }
    if (path.startsWith('/api/uploads/job_smoke/parts/') && request.method === 'PUT') {
      const size = (await request.arrayBuffer()).byteLength
      if (Number(request.headers.get('Content-Length')) !== size) {
        return Response.json({ code: 'LENGTH_MISMATCH' }, { status: 400 })
      }
      received.push(size)
      return Response.json({ ok: true })
    }
    if (path === '/api/uploads/job_smoke/complete') {
      completed = true
      return Response.json({ jobId: 'job_smoke', status: 'queued' })
    }
    if (path === '/api/uploads/job_smoke/heartbeat') return Response.json({ ok: true })
    return Response.json({ code: 'NOT_FOUND' }, { status: 404 })
  },
})

const directory = await mkdtemp(join(tmpdir(), 'teler-upload-smoke-'))
try {
  const filePath = join(directory, 'sample.csv')
  await writeFile(filePath, content)
  // Asynchronous, so this process keeps serving the executable's requests.
  const upload = Bun.spawn([executable, 'upload', filePath, '--json'], {
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      TELER_URL: `http://127.0.0.1:${server.port}`,
      TELER_TOKEN: 'smoke-token',
      TELER_NO_UPDATE_CHECK: '1',
      TELER_NO_SKILL_SYNC: '1',
    },
    stdout: 'ignore',
    stderr: 'inherit',
    timeout: 30_000,
  })
  const exitCode = await upload.exited
  const total = received.reduce((sum, size) => sum + size, 0)
  if (exitCode !== 0 || !completed || total !== content.byteLength) {
    throw new Error(
      `Upload failed: exit ${upload.signalCode ?? exitCode}, ` +
        `received ${total} of ${content.byteLength} bytes, completed ${completed}`
    )
  }
  console.info(`Uploaded ${total} bytes in ${received.length} parts`)
} finally {
  await server.stop(true)
  await rm(directory, { recursive: true, force: true })
}
