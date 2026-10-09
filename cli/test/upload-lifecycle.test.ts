import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TelerApiClient } from '../src/api'
import { uploadLocalFile } from '../src/uploads'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

function output() {
  let value = ''
  return {
    target: { json: true, metadataOnly: false, write: (text: string) => (value += text) },
    read: () => value,
  }
}

async function fixture(prefix: string, contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  const filePath = join(directory, 'sample.csv')
  await writeFile(filePath, contents)
  return filePath
}

describe('upload lifecycle recovery', () => {
  it('bounds retryable part failures to three attempts', async () => {
    const filePath = await fixture('teler-cli-retry-', 'abc')
    let puts = 0
    const client = new TelerApiClient(
      new URL('https://app.teler.ai'),
      'token',
      async (url, init) => {
        const path = new URL(url).pathname
        if (path === '/api/uploads')
          return Response.json({
            jobId: 'fpjob_test',
            partSizeBytes: 3,
            partCount: 1,
            expiresAt: '2026-09-20T01:00:00.000Z',
          })
        if (init?.method === 'PUT') {
          puts += 1
          return Response.json({}, { status: 503 })
        }
        if ((init?.method ?? 'GET') === 'GET')
          return Response.json({
            jobId: 'fpjob_test',
            status: 'uploading',
            originalFilename: 'sample.csv',
            destinationPath: '/personal',
            upload: {
              partSizeBytes: 3,
              partCount: 1,
              uploadedPartCount: 0,
              uploadedBytes: 0,
              totalBytes: 3,
            },
            counts: { queued: 0, processing: 0, completed: 0, skipped: 0, failed: 0 },
            items: [],
          })
        return Response.json({ ok: true })
      }
    )

    await expect(
      uploadLocalFile(client, output().target, {
        filePath,
        organizationId: 'org_test',
        scope: 'personal',
        wait: false,
      })
    ).rejects.toThrow('503')
    expect(puts).toBe(3)
  })

  it('retries a typed transient part conflict', async () => {
    const filePath = await fixture('teler-cli-conflict-', 'abc')
    let puts = 0
    const client = new TelerApiClient(
      new URL('https://app.teler.ai'),
      'token',
      async (url, init) => {
        const path = new URL(url).pathname
        if (path === '/api/uploads') {
          return Response.json({
            jobId: 'fpjob_test',
            partSizeBytes: 3,
            partCount: 1,
            expiresAt: '2026-09-20T01:00:00.000Z',
          })
        }
        if (init?.method === 'PUT') {
          puts += 1
          return puts === 1
            ? Response.json({ code: 'PART_BUSY' }, { status: 409 })
            : new Response(null, { status: 204 })
        }
        if ((init?.method ?? 'GET') === 'GET') {
          return Response.json({
            jobId: 'fpjob_test',
            status: 'uploading',
            originalFilename: 'sample.csv',
            destinationPath: '/personal',
            upload: {
              partSizeBytes: 3,
              partCount: 1,
              uploadedPartCount: 0,
              uploadedBytes: 0,
              totalBytes: 3,
            },
            counts: { queued: 0, processing: 0, completed: 0, skipped: 0, failed: 0 },
            items: [],
          })
        }
        return Response.json({ jobId: 'fpjob_test', status: 'queued' })
      }
    )

    await uploadLocalFile(client, output().target, {
      filePath,
      organizationId: 'org_test',
      scope: 'personal',
      wait: false,
    })

    expect(puts).toBe(2)
  })

  it('stops uploading when reconciliation finds a terminal job', async () => {
    const filePath = await fixture('teler-cli-terminal-', 'abcdef')
    const methods: string[] = []
    const sink = output()
    const client = new TelerApiClient(
      new URL('https://app.teler.ai'),
      'token',
      async (url, init) => {
        const path = new URL(url).pathname
        methods.push(`${init?.method ?? 'GET'} ${path}`)
        if (path === '/api/uploads')
          return Response.json({
            jobId: 'fpjob_test',
            partSizeBytes: 3,
            partCount: 2,
            expiresAt: '2026-09-20T01:00:00.000Z',
          })
        if (init?.method === 'PUT') return Response.json({}, { status: 503 })
        return Response.json({
          jobId: 'fpjob_test',
          status: 'failed',
          originalFilename: 'sample.csv',
          destinationPath: '/personal',
          errorCode: 'processing_failed',
          counts: { queued: 0, processing: 0, completed: 0, skipped: 0, failed: 1 },
          items: [],
        })
      }
    )

    await uploadLocalFile(client, sink.target, {
      filePath,
      organizationId: 'org_test',
      scope: 'personal',
      wait: false,
    })

    expect(methods).toEqual([
      'POST /api/uploads',
      'PUT /api/uploads/fpjob_test/parts/1',
      'GET /api/uploads/fpjob_test',
    ])
    expect(JSON.parse(sink.read())).toEqual({ jobId: 'fpjob_test', status: 'failed' })
  })

  it('does not cancel a completed upload when status polling is aborted', async () => {
    const filePath = await fixture('teler-cli-poll-', 'abc')
    const methods: string[] = []
    const controller = new AbortController()
    const client = new TelerApiClient(
      new URL('https://app.teler.ai'),
      'token',
      async (url, init) => {
        const path = new URL(url).pathname
        methods.push(`${init?.method ?? 'GET'} ${path}`)
        if (path === '/api/uploads')
          return Response.json({
            jobId: 'fpjob_test',
            partSizeBytes: 3,
            partCount: 1,
            expiresAt: '2026-09-20T01:00:00.000Z',
          })
        if (init?.method === 'PUT') return Response.json({ ok: true })
        if (path.endsWith('/complete'))
          return Response.json({ jobId: 'fpjob_test', status: 'queued' })
        return Response.json({
          jobId: 'fpjob_test',
          status: 'processing',
          originalFilename: 'sample.csv',
          destinationPath: '/personal',
          counts: { queued: 0, processing: 1, completed: 0, skipped: 0, failed: 0 },
          items: [],
        })
      }
    )
    setTimeout(() => controller.abort(), 5)

    await expect(
      uploadLocalFile(client, output().target, {
        filePath,
        organizationId: 'org_test',
        scope: 'personal',
        wait: true,
        pollIntervalMs: 20,
        signal: controller.signal,
      })
    ).rejects.toThrow('aborted')
    expect(methods.some((method) => method.startsWith('DELETE '))).toBe(false)
  })
})
