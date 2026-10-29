import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/index'

const POST = 'post_01m2mgs69ge8nvmkdg6924cgg9'
const ORG = 'org_01m2mgs69ge8nvmkdg6924cgg9'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

async function generate(events: unknown[], json = true) {
  const directory = await mkdtemp(join(tmpdir(), 'teler-post-generation-'))
  directories.push(directory)
  const file = join(directory, 'generate.json')
  await writeFile(file, JSON.stringify({ artifactIds: [], language: 'en' }))
  let stdout = ''
  let stderr = ''
  const exitCode = await main(
    ['post', 'generate', POST, '--org', ORG, '--file', file, ...(json ? ['--json'] : [])],
    {
      env: { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'example-token' },
      writeOut: (text) => {
        stdout += text
      },
      writeErr: (text) => {
        stderr += text
      },
      fetch: async () =>
        new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    }
  )
  return { stdout, stderr, exitCode }
}

describe('post generation stream errors', () => {
  it.each([
    ['GENERATION_FAILED', 'Post draft generation failed'],
    ['CANCELLED', 'Post draft generation was cancelled'],
    ['INSUFFICIENT_CREDITS', 'Not enough credits to generate a post draft'],
    ['POST_NOT_FOUND', 'Post not found'],
    ['ARTIFACT_NOT_IN_CHAT', 'A selected chart or file is not available in this post’s chat'],
  ])('preserves supported %s errors with a safe message', async (code, message) => {
    const result = await generate([
      { type: 'error', code, message: 'private upstream text', content: 'private data' },
    ])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr)).toEqual({ error: { code, message, retryable: false } })
    expect(result.stderr).not.toContain('private')
  })

  it.each(['PRIVATE_PROVIDER_CODE', 'private token value', 123, null, undefined])(
    'sanitizes unsupported error codes (%j)',
    async (code) => {
      const result = await generate([{ type: 'error', code, message: 'private upstream text' }])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(JSON.parse(result.stderr)).toEqual({
        error: {
          code: 'GENERATION_FAILED',
          message: 'Post draft generation failed',
          retryable: false,
        },
      })
    }
  )

  it('retains successful draft snapshots and completion', async () => {
    const events = [
      { type: 'snapshot', draft: { title: 'Draft', content: 'Partial' } },
      { type: 'complete', draft: { title: 'Draft', content: 'Complete' } },
    ]
    const result = await generate(events)
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(
      result.stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).toEqual(events)
  })

  it('reports an incomplete stream as a generation failure', async () => {
    const result = await generate([
      { type: 'snapshot', draft: { title: 'Draft', content: 'Partial' } },
    ])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: 'GENERATION_FAILED',
        message: 'Post draft generation did not complete',
        retryable: false,
      },
    })
  })

  it('uses the safe mapped message for human output', async () => {
    const result = await generate(
      [{ type: 'error', code: 'INSUFFICIENT_CREDITS', message: 'private upstream text' }],
      false
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('teler: Not enough credits to generate a post draft\n')
    expect(result.stdout).toBe('')
  })
})
