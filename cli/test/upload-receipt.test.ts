import { afterEach, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TelerApiClient } from '../src/api'
import { uploadLocalFile } from '../src/uploads'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

it.each([false, true])(
  'emits a durable receipt before waiting (reconciled part: %s)',
  async (reconciled) => {
    const directory = await mkdtemp(join(tmpdir(), 'teler-upload-receipt-'))
    directories.push(directory)
    const filePath = join(directory, 'sample.csv')
    await writeFile(filePath, 'x')
    const controller = new AbortController()
    let output = ''
    let polls = 0
    let deleted = false
    const client = new TelerApiClient(
      new URL('https://app.teler.example'),
      'token',
      async (url, init) => {
        const path = new URL(url).pathname
        if (init?.method === 'DELETE') deleted = true
        if (path === '/api/uploads')
          return Response.json({
            jobId: 'fpjob_example',
            partSizeBytes: 1,
            partCount: 1,
            expiresAt: '2026-10-15T00:00:00Z',
          })
        if (init?.method === 'PUT') return new Response(null, { status: reconciled ? 409 : 204 })
        if (path.endsWith('/complete'))
          return Response.json({ jobId: 'fpjob_example', status: 'queued' })
        polls += 1
        if (!reconciled || polls > 1) {
          expect(output.trim()).toBe(JSON.stringify({ jobId: 'fpjob_example', status: 'queued' }))
          controller.abort()
        }
        return Response.json({
          jobId: 'fpjob_example',
          status: 'queued',
          originalFilename: 'sample.csv',
          destinationPath: '/personal',
          counts: { queued: 1, processing: 0, completed: 0, skipped: 0, failed: 0 },
          items: [],
        })
      }
    )
    await expect(
      uploadLocalFile(
        client,
        {
          json: true,
          metadataOnly: false,
          write: (text) => {
            output += text
          },
        },
        {
          filePath,
          organizationId: 'org_example',
          scope: 'personal',
          wait: true,
          signal: controller.signal,
          pollIntervalMs: 0,
        }
      )
    ).rejects.toThrow()
    expect(output.trim()).toBe(JSON.stringify({ jobId: 'fpjob_example', status: 'queued' }))
    expect(deleted).toBe(false)
  }
)
