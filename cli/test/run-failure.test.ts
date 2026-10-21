import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TelerApiClient } from '../src/api'
import type { Output } from '../src/chats'
import { ApiError, CommandError, jsonError, UsageError } from '../src/errors'
import { defaultWatchSeconds, runAnalysisCommand } from '../src/run-command'

const suffix = '01m2mgs69ge8nvmkdg6924cgg9'
const organizationId = `org_${suffix}`
const projectId = `prj_${suffix}`
const id = `expjob_${suffix}`
const idempotencyKey = 'analysis-failure-key'
const run = {
  id,
  chatId: `chat_${suffix}`,
  projectId,
  status: 'queued',
  language: 'python',
  idempotencyKey,
  maximumCredits: '1.000000000',
  chargedCredits: null,
  tariffVersion: 'tariff-v1',
  timeoutSeconds: 3600,
  cancelRequested: false,
  output: null,
  errorCode: null,
  executionTimeMs: null,
  artifacts: [],
  artifactsTruncated: false,
  createdAt: '2026-10-07T10:00:00.000Z',
  settledAt: null,
}
const traceback = [
  'Traceback (most recent call last):',
  '  Cell In[1], line 3',
  "KeyError: 'revenue'",
].join('\n')
const failed = {
  ...run,
  status: 'failed',
  errorCode: 'execution_failed',
  chargedCredits: '0.010000000',
  errorDetail: traceback,
}

let directory = ''
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'teler-run-failure-'))
  await writeFile(join(directory, 'analysis.py'), 'frame["revenue"]\n')
})
afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

const submitArgs = (...extra: string[]) => [
  '--file',
  join(directory, 'analysis.py'),
  '--project',
  projectId,
  '--org',
  organizationId,
  '--max-credits',
  '1',
  '--idempotency-key',
  idempotencyKey,
  ...extra,
]

function harness(responses: Response[], json = true) {
  const requests: { path: string; body: unknown }[] = []
  let text = ''
  const client = new TelerApiClient(
    new URL('https://app.teler.example'),
    undefined,
    async (url, init) => {
      requests.push({
        path: new URL(url).pathname,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return responses.shift() ?? Response.json(failed)
    }
  )
  const output: Output = { json, metadataOnly: false, write: (value) => void (text += value) }
  let elapsed = 0
  const clock = { now: () => elapsed, sleep: async (ms: number) => void (elapsed += ms) }
  const invoke = (action: string, args: string[]) =>
    runAnalysisCommand('run', action, args, client, output, clock)
  return { requests, invoke, text: () => text }
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Expected the command to fail')
    },
    (error: unknown) => error
  )
}

describe('execution time limit', () => {
  test('accepts up to an hour locally and leaves the plan limit to the server', async () => {
    const h = harness([Response.json({ run: { ...run, status: 'completed' } })])
    await h.invoke('python', submitArgs('--execution-timeout', '3600'))
    expect(h.requests[0]?.body).toMatchObject({ timeoutSeconds: 3600 })
    const over = harness([])
    expect(
      await failure(over.invoke('python', submitArgs('--execution-timeout', '3601')))
    ).toBeInstanceOf(UsageError)
    expect(over.requests).toHaveLength(0)
  })

  test("names the plan's limit when the server refuses a longer run", async () => {
    const h = harness([
      Response.json(
        {
          code: 'TIME_LIMIT_EXCEEDED',
          error: 'untrusted server text',
          limitSeconds: 600,
          retryable: false,
        },
        { status: 400 }
      ),
    ])
    const error = await failure(h.invoke('python', submitArgs('--execution-timeout', '900')))
    expect(error).toBeInstanceOf(ApiError)
    expect(jsonError(error).error).toMatchObject({
      code: 'TIME_LIMIT_EXCEEDED',
      status: 400,
      hint: 'Your plan allows runs of up to 600 seconds; lower --execution-timeout.',
    })
    expect(JSON.stringify(jsonError(error))).not.toContain('untrusted server text')
  })

  test('waits long enough for a long run unless --timeout says otherwise', () => {
    expect(defaultWatchSeconds(60)).toBe(180)
    expect(defaultWatchSeconds(3600)).toBe(3720)
  })
})

describe('a failed run', () => {
  test('returns the traceback in the JSON receipt and says what to do next', async () => {
    const h = harness([Response.json(failed)])
    const error = await failure(h.invoke('wait', [id, '--org', organizationId]))
    expect(JSON.parse(h.text())).toMatchObject({ errorDetail: traceback })
    expect(error).toBeInstanceOf(CommandError)
    expect(jsonError(error).error).toMatchObject({
      code: 'RUN_FAILED',
      hint: expect.stringContaining('new --idempotency-key'),
    })
  })

  test('prints the traceback, without terminal control sequences, in plain output', async () => {
    const h = harness(
      [Response.json({ ...failed, errorDetail: `\x1b[31m${traceback}\x1b[0m\x07` })],
      false
    )
    await h.invoke('get', [id, '--org', organizationId])
    expect(h.text()).toBe(`${id}\tfailed\tpython\tcharged=0.010000000\n${traceback}\n`)
  })

  test('from an older server without the detail keeps the same receipt', async () => {
    const { errorDetail: _detail, ...older } = failed
    const h = harness([Response.json(older)])
    await h.invoke('get', [id, '--org', organizationId])
    expect(JSON.parse(h.text())).toEqual(older)
  })

  test('that ran out of credits or time says which limit to raise', async () => {
    for (const [errorCode, flag] of [
      ['budget_exhausted', '--max-credits'],
      ['time_limit', '--execution-timeout'],
    ] as const) {
      const h = harness([Response.json({ ...failed, errorCode, errorDetail: null })])
      const error = await failure(h.invoke('wait', [id, '--org', organizationId]))
      expect(jsonError(error).error).toMatchObject({ hint: expect.stringContaining(flag) })
    }
  })
})
