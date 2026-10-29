import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError, CommandError, UsageError } from '../src/errors'
import { TelerApiClient } from '../src/api'
import type { Output } from '../src/chats'
import { runAnalysisCommand } from '../src/run-command'

const suffix = '01m2mgs69ge8nvmkdg6924cgg9'
const organizationId = `org_${suffix}`
const projectId = `prj_${suffix}`
const id = `expjob_${suffix}`
const requestId = `clireq_${suffix}`
const idempotencyKey = 'model-training-key-01'
const capabilities = ['tables.metadata.read', 'tables.rows.read', 'files.create']
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
  timeoutSeconds: 60,
  cancelRequested: false,
  output: null,
  errorCode: null,
  executionTimeMs: null,
  artifacts: [],
  artifactsTruncated: false,
  createdAt: '2026-10-07T10:00:00.000Z',
  settledAt: null,
}
const approval = {
  requestId,
  path: `/cli-requests/${requestId}`,
  expiresAt: '2026-10-07T10:15:00.000Z',
  asks: [{ capability: 'files.create' }],
  scopes: ['once', 'always'],
}
const waiting = { ...run, status: 'needs_approval', capabilities: null, approval }
const completed = {
  ...run,
  status: 'completed',
  capabilities,
  approval: null,
  output: 'saved\n',
  chargedCredits: '0.010000000',
}
const quote = {
  run: null,
  maximumCredits: '1.000000000',
  tariffVersion: run.tariffVersion,
  reservedMemoryMiB: 2048,
  payer: { organizationId, userId: `user_${suffix}`, membershipId: `member_${suffix}` },
  funding: {
    kind: 'shared_manual',
    availableOrganizationCredits: '10',
    split: { organizationCredits: '1', personalCredits: '0', referralCredits: '0' },
  },
}

let directory = ''
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'teler-run-capabilities-'))
  await writeFile(join(directory, 'train.py'), 'print("saved")\n')
})
afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

const submitArgs = (...extra: string[]) => [
  '--file',
  join(directory, 'train.py'),
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

/** Answers by request order; a run read answers from `poll`, given the fake clock's time. */
function harness(
  answers: (unknown | Error)[],
  poll: (elapsedMs: number) => unknown = () => waiting,
  json = true
) {
  const requests: { path: string; method: string; body: unknown }[] = []
  let text = ''
  let elapsed = 0
  const client = new TelerApiClient(
    new URL('https://app.teler.example'),
    undefined,
    async (url, init) => {
      const path = new URL(url).pathname + new URL(url).search
      requests.push({
        path,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      const answer = (init?.method ?? 'GET') === 'GET' ? poll(elapsed) : answers.shift()
      if (answer instanceof Error) throw answer
      if (answer instanceof Response) return answer
      return Response.json(answer)
    }
  )
  const output: Output = {
    json,
    metadataOnly: false,
    write: (value) => {
      text += value
    },
  }
  const clock = {
    now: () => elapsed,
    sleep: async (ms: number) => {
      elapsed += ms
    },
  }
  return {
    requests,
    text: () => text,
    receipts: () =>
      text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    reads: () => requests.filter((request) => request.method === 'GET').length,
    invoke: (args: string[], action = 'python', group = 'run') =>
      runAnalysisCommand(group, action, args, client, output, clock),
  }
}

describe('run --capabilities', () => {
  test('asks for the listed capabilities in the quote and the submit', async () => {
    const h = harness([quote, waiting])
    await h.invoke(
      submitArgs('--capabilities', ' files.create,tables.rows.read ,tables.metadata.read')
    )
    expect(h.requests[0]?.body).toMatchObject({
      capabilities: ['files.create', 'tables.rows.read', 'tables.metadata.read'],
    })
    expect(h.requests[1]?.body).toMatchObject({
      capabilities: ['files.create', 'tables.rows.read', 'tables.metadata.read'],
    })
  })

  test('a waiting run names what to approve and where, in JSON and in plain output', async () => {
    const h = harness([quote, waiting])
    await h.invoke(submitArgs('--capabilities', capabilities.join(',')))
    const [receipt] = h.receipts()
    expect(receipt).toMatchObject({
      status: 'needs_approval',
      approval,
      approvalUrl: `https://app.teler.example/cli-requests/${requestId}`,
    })
    expect(receipt.hint).toContain('files.create')
    expect(receipt.hint).toContain(`https://app.teler.example/cli-requests/${requestId}`)

    const plain = harness([quote, waiting], () => waiting, false)
    await plain.invoke(submitArgs('--capabilities', capabilities.join(',')))
    expect(plain.text()).toContain('needs_approval')
    expect(plain.text()).toContain(
      `Approve files.create in the Teler app: https://app.teler.example/cli-requests/${requestId}`
    )
  })

  test('--wait waits for the approval, past the run limit, then for the run', async () => {
    // Approved ten minutes in: longer than a run's own default wait of three minutes.
    const h = harness([quote, waiting], (elapsed) => (elapsed < 600_000 ? waiting : completed))
    await h.invoke(submitArgs('--capabilities', capabilities.join(','), '--wait'))
    expect(h.receipts().map((receipt) => receipt.status)).toEqual(['needs_approval', 'completed'])
    // While it waits for a person it reads every few seconds, not every second.
    expect(h.reads()).toBeLessThan(200)
  })

  test('a run that was not approved says so', async () => {
    const cancelled = { ...run, status: 'cancelled', approval: null, cancelRequested: true }
    const h = harness([quote, waiting], (elapsed) => (elapsed < 30_000 ? waiting : cancelled))
    const failure = h.invoke(submitArgs('--capabilities', capabilities.join(','), '--wait'))
    await expect(failure).rejects.toBeInstanceOf(CommandError)
    await expect(failure).rejects.toMatchObject({
      code: 'RUN_CANCELLED',
      hint: expect.stringContaining('not approved'),
    })
  })

  test('rejects a malformed list before any request', async () => {
    for (const value of ['', ',', 'Files.Create', 'files create', 'files.create,../x']) {
      const h = harness([])
      await expect(h.invoke(submitArgs('--capabilities', value))).rejects.toBeInstanceOf(UsageError)
      expect(h.requests).toHaveLength(0)
    }
  })

  test('without --capabilities nothing new is sent', async () => {
    const h = harness([quote, run])
    await h.invoke(submitArgs())
    expect(h.requests[0]?.body).not.toHaveProperty('capabilities')
    expect(h.requests[1]?.body).not.toHaveProperty('capabilities')
  })

  test('a failed run without --capabilities names what Agent Access left out', async () => {
    const excluded = {
      ...quote,
      capabilities: {
        requested: ['tables.metadata.read', 'tables.rows.read'],
        asks: [],
        excluded: [
          { capability: 'files.create', state: 'ask' },
          { capability: 'files.delete', state: 'deny' },
        ],
        approvalScopes: [],
      },
    }
    const failed = {
      ...run,
      status: 'failed',
      errorCode: 'execution_failed',
      errorDetail: 'Refused. Nothing was saved.',
    }
    const h = harness([excluded, run], () => failed)
    const error = await h.invoke(submitArgs('--wait')).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CommandError)
    const { code, hint } = error as CommandError
    expect(code).toBe('RUN_FAILED')
    expect(hint).toContain('--capabilities')
    expect(hint).toContain('files.create')
    expect(hint).not.toContain('files.delete')
  })

  test('a refusal that names capabilities says what to pass', async () => {
    const refusal = (status: number, code: string, named: string[]) =>
      Response.json({ code, error: code, retryable: false, capabilities: named }, { status })
    const cases = [
      [
        409,
        'CAPABILITY_APPROVAL_REQUIRED',
        ['tables.rows.read'],
        '--capabilities tables.rows.read',
      ],
      [400, 'CAPABILITY_REQUIRED', ['files.create'], 'files.create'],
      [403, 'CAPABILITY_DENIED', ['files.delete'], 'files.delete'],
    ] as const
    for (const [status, code, named, expected] of cases) {
      const h = harness([refusal(status, code, [...named])])
      const failure = h.invoke(submitArgs('--capabilities', 'files.create'), 'query', 'data')
      await expect(failure).rejects.toBeInstanceOf(ApiError)
      await expect(failure).rejects.toMatchObject({
        code,
        message: expect.stringContaining(expected),
      })
    }
  })
})
