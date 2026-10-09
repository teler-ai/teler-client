import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TelerApiClient } from '../src/api'
import { uploadCompleteSchema } from '../src/upload-contract'
import { listUploads, showUploadStatus, uploadLocalFile } from '../src/uploads'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

function output(json = true) {
  let value = ''
  return {
    target: { json, metadataOnly: false, write: (text: string) => (value += text) },
    read: () => value,
  }
}

describe('upload commands', () => {
  it('rejects an uploading status from the completion endpoint', () => {
    expect(
      uploadCompleteSchema.safeParse({ jobId: 'fpjob_test', status: 'uploading' }).success
    ).toBe(false)
  })

  it('streams file slices through the multipart API and completes the job', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'teler-cli-upload-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'sample.csv')
    await writeFile(filePath, 'abcdef')
    const requests: Array<{ path: string; method: string; body?: RequestInit['body'] }> = []
    const client = new TelerApiClient(
      new URL('https://app.teler.ai'),
      'token',
      async (url, init) => {
        const path = new URL(url).pathname
        requests.push({ path, method: init?.method ?? 'GET', body: init?.body })
        if (path === '/api/uploads') {
          return Response.json(
            {
              jobId: 'fpjob_test',
              partSizeBytes: 3,
              partCount: 2,
              expiresAt: '2026-09-20T01:00:00.000Z',
            },
            { status: 201 }
          )
        }
        if (path.endsWith('/complete'))
          return Response.json({ jobId: 'fpjob_test', status: 'queued' })
        return Response.json({ ok: true })
      }
    )
    const sink = output()

    await uploadLocalFile(client, sink.target, {
      filePath,
      organizationId: 'org_test',
      destinationPath: 'imports',
      scope: 'personal',
      wait: false,
    })

    expect(requests.map(({ path, method }) => `${method} ${path}`)).toEqual([
      'POST /api/uploads',
      'PUT /api/uploads/fpjob_test/parts/1',
      'PUT /api/uploads/fpjob_test/parts/2',
      'POST /api/uploads/fpjob_test/complete',
    ])
    expect(await new Response(requests[1]?.body).text()).toBe('abc')
    expect(await new Response(requests[2]?.body).text()).toBe('def')
    expect(JSON.parse(String(requests[0]?.body)).destinationPath).toBe('/personal/imports')
    expect(JSON.parse(sink.read())).toEqual({ jobId: 'fpjob_test', status: 'queued' })
  })

  it('clears the upload heartbeat as soon as byte transfer completes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'teler-cli-heartbeat-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'sample.csv')
    await writeFile(filePath, 'a')
    const setIntervalSpy = spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = spyOn(globalThis, 'clearInterval')
    try {
      const client = new TelerApiClient(
        new URL('https://app.teler.ai'),
        'token',
        async (url, init) => {
          const path = new URL(url).pathname
          if (path === '/api/uploads') {
            return Response.json({
              jobId: 'fpjob_test',
              partSizeBytes: 1,
              partCount: 1,
              expiresAt: '2026-09-20T01:00:00.000Z',
            })
          }
          if (path.endsWith('/complete')) {
            return Response.json({ jobId: 'fpjob_test', status: 'queued' })
          }
          if (init?.method === 'PUT') return new Response(null, { status: 204 })
          expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
          return Response.json({
            jobId: 'fpjob_test',
            status: 'completed',
            originalFilename: 'sample.csv',
            destinationPath: '/personal',
            counts: { queued: 0, processing: 0, completed: 1, skipped: 0, failed: 0 },
            items: [],
          })
        }
      )

      await uploadLocalFile(client, output().target, {
        filePath,
        organizationId: 'org_test',
        scope: 'personal',
        wait: true,
      })

      expect(setIntervalSpy).toHaveBeenCalledTimes(1)
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
    } finally {
      setIntervalSpy.mockRestore()
      clearIntervalSpy.mockRestore()
    }
  })

  it('preserves multipart boundaries and binary part headers', async () => {
    const partSize = 8 * 1024 * 1024
    for (const size of [1, partSize, partSize + 1]) {
      const directory = await mkdtemp(join(tmpdir(), 'teler-cli-boundary-'))
      temporaryDirectories.push(directory)
      const filePath = join(directory, 'sample.csv')
      await writeFile(filePath, new Uint8Array(size))
      const parts: Array<{
        size: number
        contentLength: string | null
        contentType: string | null
      }> = []
      const client = new TelerApiClient(
        new URL('https://app.teler.ai'),
        'token',
        async (url, init) => {
          const path = new URL(url).pathname
          if (path === '/api/uploads') {
            return Response.json({
              jobId: `fpjob_${size}`,
              partSizeBytes: partSize,
              partCount: Math.ceil(size / partSize),
              expiresAt: '2026-09-20T01:00:00.000Z',
            })
          }
          if (init?.method === 'PUT') {
            parts.push({
              size: (init.body as Blob).size,
              contentLength: new Headers(init.headers).get('content-length'),
              contentType: new Headers(init.headers).get('content-type'),
            })
            return Response.json({ ok: true })
          }
          return Response.json({ jobId: `fpjob_${size}`, status: 'queued' })
        }
      )

      await uploadLocalFile(client, output().target, {
        filePath,
        organizationId: 'org_test',
        scope: 'personal',
        wait: false,
      })

      const expectedSizes = size > partSize ? [partSize, 1] : [size]
      expect(parts.map((part) => part.size)).toEqual(expectedSizes)
      expect(parts.map((part) => part.contentLength)).toEqual(expectedSizes.map(String))
      expect(parts.every((part) => part.contentType === 'application/octet-stream')).toBe(true)
    }
  })

  it('lists concise upload summaries with filters', async () => {
    let requested = ''
    const client = new TelerApiClient(new URL('https://app.teler.ai'), 'token', async (url) => {
      requested = url
      return Response.json({
        items: [
          {
            jobId: 'fpjob_test',
            status: 'completed',
            originalFilename: 'sample.csv',
            destinationPath: '/personal',
            scope: 'personal',
            declaredSizeBytes: 6,
            createdAt: '2026-09-20T00:00:00.000Z',
            completedAt: '2026-09-20T00:00:01.000Z',
          },
        ],
      })
    })
    const sink = output()

    await listUploads(client, sink.target, {
      organizationId: 'org_test',
      status: 'completed',
      limit: 7,
    })

    expect(Object.fromEntries(new URL(requested).searchParams)).toEqual({
      organizationId: 'org_test',
      status: 'completed',
      limit: '7',
    })
    expect(JSON.parse(sink.read()).items[0].jobId).toBe('fpjob_test')
  })

  it('polls upload status until processing is terminal', async () => {
    let requestCount = 0
    const client = new TelerApiClient(new URL('https://app.teler.ai'), 'token', async () => {
      requestCount += 1
      return Response.json({
        jobId: 'fpjob_test',
        status: requestCount === 1 ? 'processing' : 'completed',
        originalFilename: 'sample.csv',
        destinationPath: '/personal',
        counts: { queued: 0, processing: 0, completed: 1, skipped: 0, failed: 0 },
        items: [],
      })
    })
    const sink = output()

    await showUploadStatus(client, sink.target, 'fpjob_test', { wait: true, pollIntervalMs: 0 })

    expect(requestCount).toBe(2)
    expect(JSON.parse(sink.read()).status).toBe('completed')
  })

  it('cancels an incomplete job after a part upload failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'teler-cli-upload-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'sample.csv')
    await writeFile(filePath, 'abc')
    const methods: string[] = []
    const controller = new AbortController()
    let cleanupSignal: AbortSignal | null | undefined
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
        if ((init?.method ?? 'GET') === 'GET')
          return Response.json({
            jobId: 'fpjob_test',
            status: 'uploading',
            originalFilename: 'sample.csv',
            destinationPath: '/personal',
            counts: { queued: 0, processing: 0, completed: 0, skipped: 0, failed: 0 },
            items: [],
          })
        if (init?.method === 'DELETE') {
          cleanupSignal = init.signal
          return Response.json({ ok: true })
        }
        if (init?.method === 'PUT') controller.abort()
        return Response.json({}, { status: 400 })
      }
    )

    await expect(
      uploadLocalFile(client, output().target, {
        filePath,
        organizationId: 'org_test',
        scope: 'personal',
        wait: false,
        signal: controller.signal,
      })
    ).rejects.toThrow('failed')
    expect(
      methods.filter((method) => method === 'PUT /api/uploads/fpjob_test/parts/1')
    ).toHaveLength(1)
    expect(methods.at(-1)).toBe('DELETE /api/uploads/fpjob_test')
    expect(cleanupSignal).toBe(controller.signal)
    expect(cleanupSignal?.aborted).toBe(true)
  })
})
