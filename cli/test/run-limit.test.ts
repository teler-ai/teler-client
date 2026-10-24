import { describe, expect, test } from 'bun:test'
import { main } from '../src/index'

const suffix = '01m2mgs69ge8nvmkdg6924cgg9'
const organizationId = `org_${suffix}`
const id = `expjob_${suffix}`
const CONTACT = 'https://teler.ai/contact?topic=sales'
const COMPUTE_LINE = `teler: Run ${id} needs more compute than is available here.\n`
const GPU_LINE = `teler: Run ${id} needs a GPU.\n`
const CONTACT_LINE = `Contact sales: ${CONTACT}\n`
const COMPUTE_HINT = `This request needs more compute than is available here. Contact sales: ${CONTACT}`
const GPU_HINT = `This request needs a GPU. Contact sales: ${CONTACT}`

const failedRun = {
  id,
  chatId: `chat_${suffix}`,
  projectId: `prj_${suffix}`,
  status: 'failed',
  language: 'python',
  idempotencyKey: 'run-limit-test-key',
  maximumCredits: '1.000000000',
  chargedCredits: '0.010000000',
  tariffVersion: 'tariff-v1',
  timeoutSeconds: 60,
  cancelRequested: false,
  output: null,
  errorCode: 'execution_failed',
  executionTimeMs: 1200,
  artifacts: [],
  artifactsTruncated: false,
  createdAt: '2026-10-07T10:00:00.000Z',
  settledAt: '2026-10-07T10:00:02.000Z',
}

async function run(action: 'wait' | 'get', body: object, json: boolean) {
  let stdout = ''
  let stderr = ''
  const exitCode = await main(
    ['run', action, id, '--org', organizationId, ...(json ? ['--json'] : [])],
    {
      env: { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'example-token' },
      fetch: async () => Response.json(body),
      writeOut: (text) => void (stdout += text),
      writeErr: (text) => void (stderr += text),
    }
  )
  return { exitCode, stdout, stderr }
}

const limit = (kind: string) => ({ kind, contactUrl: 'https://server.example/contact' })

describe('a run that stopped at a limit of the sandbox', () => {
  test.each([
    ['memory_limit', COMPUTE_LINE],
    ['time_limit', COMPUTE_LINE],
    ['gpu_needed', GPU_LINE],
  ])('%s says what happened and where to ask, with the usual exit status', async (code, line) => {
    const failed = {
      ...failedRun,
      errorCode: code,
      limit: limit(code),
      errorDetail: 'The sandbox stopped it.',
    }
    for (const action of ['wait', 'get'] as const) {
      const result = await run(action, failed, false)
      expect(result.stdout).toBe(
        `${id}\tfailed\tpython\tcharged=0.010000000\nThe sandbox stopped it.\n`
      )
      expect(result.exitCode).toBe(action === 'wait' ? 1 : 0)
      if (action === 'wait') expect(result.stderr.startsWith(`${line}${CONTACT_LINE}`)).toBe(true)
      else expect(result.stderr).toBe('')
    }
    const waited = await run('wait', failed, false)
    expect(waited.stderr).not.toContain(`failed (${code})`)
    expect(waited.stderr).not.toContain('server.example')
  })

  test('prints the exact two lines for a memory limit', async () => {
    const result = await run(
      'wait',
      { ...failedRun, errorCode: 'memory_limit', limit: limit('memory_limit') },
      false
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe(`${COMPUTE_LINE}${CONTACT_LINE}`)
  })

  test('prints the exact two lines for a GPU need', async () => {
    const result = await run(
      'wait',
      { ...failedRun, errorCode: 'gpu_needed', limit: limit('gpu_needed') },
      false
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe(`${GPU_LINE}${CONTACT_LINE}`)
  })

  test.each([
    ['memory_limit', COMPUTE_HINT],
    ['time_limit', COMPUTE_HINT],
    ['gpu_needed', GPU_HINT],
  ])('--json for %s adds a hint and passes the limit through', async (code, hint) => {
    const failed = { ...failedRun, errorCode: code, limit: limit(code) }
    for (const action of ['wait', 'get'] as const) {
      const result = await run(action, failed, true)
      expect(JSON.parse(result.stdout)).toEqual({ ...failed, hint })
      expect(result.exitCode).toBe(action === 'wait' ? 1 : 0)
    }
    const waited = await run('wait', failed, true)
    expect(JSON.parse(waited.stderr).error).toMatchObject({ code: 'RUN_FAILED' })
  })

  test('a time limit with limit.kind time_limit shows the contact lines and no timeout advice', async () => {
    const limited = { ...failedRun, errorCode: 'time_limit', limit: { kind: 'time_limit' } }
    const plain = await run('wait', limited, false)
    expect(plain.exitCode).toBe(1)
    expect(plain.stderr).toBe(`${COMPUTE_LINE}${CONTACT_LINE}`)
    const json = await run('wait', limited, true)
    expect(JSON.parse(json.stdout)).toEqual({ ...limited, hint: COMPUTE_HINT })
    expect(JSON.parse(json.stderr).error).not.toHaveProperty('hint')
  })

  test('adds no size, memory, core or time figure of its own', async () => {
    const result = await run(
      'wait',
      { ...failedRun, errorCode: 'memory_limit', limit: limit('memory_limit') },
      true
    )
    const { hint } = JSON.parse(result.stdout) as { hint: string }
    expect(hint).not.toMatch(/\d|GB|MiB|CPU|core|minute|second|plan|price|larger|bigger/i)
    expect(`${COMPUTE_LINE}${CONTACT_LINE}${GPU_LINE}`.replaceAll(id, '<id>')).not.toMatch(
      /\d|GB|MiB|CPU|core|minute|second|plan|price|larger|bigger/i
    )
  })
})

describe('a run that stopped at its own limit', () => {
  const HINT =
    "hint: Raise --execution-timeout (up to your plan's limit) or do less per run, then submit it again with a new --idempotency-key (the same key returns this run).\n"

  test.each([
    ['older server: errorCode only', {}],
    ['newer server: null limit', { limit: null }],
    ['a limit of another kind', { limit: { kind: 'other' } }],
  ])("keeps today's output exactly (%s)", async (_name, extra) => {
    const older = { ...failedRun, errorCode: 'time_limit', ...extra }
    const plain = await run('wait', older, false)
    expect(plain.exitCode).toBe(1)
    expect(plain.stderr).toBe(`teler: Run ${id} failed (time_limit)\n${HINT}`)
    const json = await run('wait', older, true)
    expect(JSON.parse(json.stdout)).toEqual(older)
    expect(JSON.parse(json.stdout)).not.toHaveProperty('hint')
  })

  test('memory_limit or gpu_needed without a limit object are ordinary failures', async () => {
    for (const errorCode of ['memory_limit', 'gpu_needed']) {
      const result = await run('wait', { ...failedRun, errorCode }, false)
      expect(result.stderr).toBe(`teler: Run ${id} failed (${errorCode})\n`)
    }
  })
})

describe('an ordinary failed run', () => {
  test('keeps its failure line and gets neither a hint nor a limit', async () => {
    const plain = await run('wait', failedRun, false)
    expect(plain.exitCode).toBe(1)
    expect(plain.stderr).toBe(
      `teler: Run ${id} failed (execution_failed)\nhint: Fix the code, then submit it again with a new --idempotency-key (the same key returns this run).\n`
    )
    expect(plain.stderr).not.toContain('Contact sales')
    const json = await run('wait', failedRun, true)
    const receipt = JSON.parse(json.stdout) as Record<string, unknown>
    expect(receipt).toEqual(failedRun)
    expect('hint' in receipt).toBe(false)
    expect('limit' in receipt).toBe(false)
  })

  test('with a null limit from a newer server, stays as the server sent it', async () => {
    const json = await run('get', { ...failedRun, limit: null }, true)
    const receipt = JSON.parse(json.stdout) as Record<string, unknown>
    expect(receipt).toEqual({ ...failedRun, limit: null })
    expect('hint' in receipt).toBe(false)
  })

  test('a limit code on a run that did not fail gets no hint', async () => {
    const json = await run(
      'get',
      { ...failedRun, status: 'completed', errorCode: 'time_limit', limit: limit('time_limit') },
      true
    )
    expect('hint' in (JSON.parse(json.stdout) as object)).toBe(false)
  })
})
