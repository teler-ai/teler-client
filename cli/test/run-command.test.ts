import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TelerApiClient } from '../src/api'
import type { Output } from '../src/chats'
import { CommandError, UsageError } from '../src/errors'
import { runAnalysisCommand } from '../src/run-command'
import { runSubmitInputJsonSchema, runTaskSchema } from '../src/run-contract'

const suffix = '01m2mgs69ge8nvmkdg6924cgg9'
const organizationId = `org_${suffix}`
const projectId = `prj_${suffix}`
const id = `expjob_${suffix}`
const idempotencyKey = 'analysis-repeatable-key'
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
const quote = {
  run: null,
  maximumCredits: '1.000000000',
  tariffVersion: run.tariffVersion,
  reservedMemoryMiB: 2048,
  payer: { organizationId, userId: `user_${suffix}`, membershipId: `member_${suffix}` },
  funding: {
    kind: 'personal',
    availableOrganizationCredits: '0',
    split: {
      organizationCredits: '0',
      personalCredits: '1',
      referralCredits: '0',
    },
  },
}
let directory = ''
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'teler-run-command-'))
  await writeFile(join(directory, 'analysis.py'), 'print("hello")\n')
  await writeFile(join(directory, 'analysis.sql'), 'SELECT 1 AS count;')
  await writeFile(
    join(directory, 'artifact.json'),
    JSON.stringify({ type: 'metric', label: 'Count', value: 12 })
  )
  await writeFile(join(directory, 'oversize.py'), 'x'.repeat(256 * 1024 + 1))
})
afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

function submitArgs(file = 'analysis.py') {
  return [
    '--file',
    join(directory, file),
    '--project',
    projectId,
    '--org',
    organizationId,
    '--max-credits',
    '1',
    '--idempotency-key',
    idempotencyKey,
  ]
}

function harness(responses: (unknown | Error)[]) {
  const requests: { path: string; method: string; body: unknown }[] = []
  let text = ''
  const client = new TelerApiClient(
    new URL('https://app.teler.ai'),
    undefined,
    async (url, init) => {
      requests.push({
        path: new URL(url).pathname + new URL(url).search,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      const response = responses.shift()
      if (response instanceof Error) throw response
      return Response.json(response)
    }
  )
  const output: Output = {
    json: true,
    metadataOnly: false,
    write: (value) => {
      text += value
    },
  }
  const receipts = () =>
    text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  const invoke = (action: string, args: string[], group = 'run') =>
    runAnalysisCommand(group, action, args, client, output, clock())
  return { client, output, requests, receipts, invoke }
}

function clock() {
  let elapsed = 0
  return {
    now: () => elapsed,
    sleep: async (ms: number) => {
      elapsed += ms
    },
  }
}

describe('direct analysis commands', () => {
  test('quotes full intent then maps exact approval and idempotency to one submit', async () => {
    const h = harness([quote, { ...run, privateField: 'must-not-project' }])
    expect(await h.invoke('python', submitArgs())).toBe(true)
    const intent = {
      projectId,
      task: { kind: 'python', code: 'print("hello")\n' },
      timeoutSeconds: 60,
      idempotencyKey,
      maximumCredits: '1',
    }
    expect(h.requests).toEqual([
      {
        path: `/api/runs/preflight?organizationId=${organizationId}`,
        method: 'POST',
        body: intent,
      },
      {
        path: `/api/runs?organizationId=${organizationId}`,
        method: 'POST',
        body: {
          ...intent,
          maximumCredits: quote.maximumCredits,
          tariffVersion: quote.tariffVersion,
          approvedPayer: quote.payer,
          approvedFunding: quote.funding,
          approvedReservedMemoryMiB: quote.reservedMemoryMiB,
        },
      },
    ])
    expect(h.receipts()).toEqual([run])
  })

  test('maps SQL and imported artifacts through the same request contract', async () => {
    for (const sample of [
      {
        group: 'data',
        action: 'query',
        file: 'analysis.sql',
        extra: ['--row-limit', '5'],
        task: { kind: 'sql', sql: 'SELECT 1 AS count;', rowLimit: 5 },
      },
      {
        group: 'artifact',
        action: 'create',
        file: 'artifact.json',
        extra: [],
        task: { kind: 'artifact', artifact: { type: 'metric', label: 'Count', value: 12 } },
      },
    ]) {
      const h = harness([quote, { ...run, language: sample.task.kind }])
      await h.invoke(sample.action, [...submitArgs(sample.file), ...sample.extra], sample.group)
      expect(h.requests[0]?.body).toMatchObject({ task: sample.task })
    }
  })

  test('rejects options and task bounds before any network request', async () => {
    const invalid = [
      ['--file', '/does-not-exist', '--project', projectId],
      [...submitArgs(), '--unexpected'],
      [...submitArgs(), '--execution-timeout', '121'],
      [...submitArgs(), '--timeout', '0', '--wait'],
      submitArgs('oversize.py'),
    ]
    for (const args of invalid) {
      const h = harness([])
      await expect(h.invoke('python', args)).rejects.toBeInstanceOf(UsageError)
      expect(h.requests).toHaveLength(0)
    }
    expect(
      runTaskSchema.safeParse({
        kind: 'artifact',
        artifact: { type: 'table', data: [{}], path: '/arbitrary' },
      }).success
    ).toBe(false)
    expect(runSubmitInputJsonSchema).toHaveProperty('properties.task')
  })

  test('reuses preflight replay without funding or a duplicate submit', async () => {
    const completed = { ...run, status: 'completed', chargedCredits: '1', output: 'hello\n' }
    const h = harness([{ run: completed }])
    await h.invoke('python', [...submitArgs(), '--wait'])
    expect(h.requests).toHaveLength(1)
    expect(h.receipts()).toEqual([completed])
  })

  test('gets a durable run and explicitly requests cancellation', async () => {
    for (const action of ['get', 'cancel']) {
      const h = harness([run])
      await h.invoke(action, [id, '--org', organizationId])
      expect(h.requests).toEqual([
        {
          path: `/api/runs/${id}${action === 'cancel' ? '/cancel' : ''}?organizationId=${organizationId}`,
          method: action === 'cancel' ? 'POST' : 'GET',
          body: action === 'cancel' ? {} : null,
        },
      ])
      expect(h.receipts()).toEqual([run])
    }
  })

  test('prints accepted receipt immediately and the final receipt after polling', async () => {
    const completed = { ...run, status: 'completed', output: 'hello\n', chargedCredits: '0.001' }
    const h = harness([quote, run, { ...run, status: 'running' }, completed])
    await h.invoke('python', [...submitArgs(), '--wait'])
    expect(h.receipts()).toEqual([run, completed])
    expect(h.requests.filter((request) => request.method === 'POST')).toHaveLength(2)
  })

  test('prints failed/cancelled terminal receipts and returns typed command failures', async () => {
    for (const status of ['failed', 'cancelled']) {
      const failed = { ...run, status, errorCode: 'queue_expired' }
      const h = harness([failed])
      try {
        await h.invoke('wait', [id, '--org', organizationId])
        throw new Error('Expected command failure')
      } catch (error) {
        expect(error).toBeInstanceOf(CommandError)
        expect((error as CommandError).code).toBe(`RUN_${status.toUpperCase()}`)
      }
      expect(h.receipts()).toEqual([failed])
    }
  })

  test('timeout preserves the last receipt and recovery ID without cancelling', async () => {
    const h = harness([run, { ...run, status: 'running' }])
    await expect(
      h.invoke('wait', [id, '--org', organizationId, '--timeout', '2'])
    ).rejects.toMatchObject({ code: 'TIMEOUT', message: expect.stringContaining(id) })
    expect(h.receipts().at(-1)).toMatchObject({ id, status: 'running' })
    expect(h.requests.every((request) => request.method === 'GET')).toBe(true)
  })

  test('network loss never resubmits and unrelated commands fall through', async () => {
    const h = harness([quote, new Error('network unavailable')])
    await expect(h.invoke('python', submitArgs())).rejects.toMatchObject({ code: 'NETWORK' })
    expect(h.requests).toHaveLength(2)
    expect(await runAnalysisCommand('data', 'list', [], h.client, h.output)).toBe(false)
    expect(await runAnalysisCommand('artifact', 'source', [], h.client, h.output)).toBe(false)
  })

  test('compares exact decimal ceilings and rejects mismatched replay receipts', async () => {
    const h = harness([{ ...quote, maximumCredits: '99.000000002' }])
    const args = submitArgs()
    args[args.indexOf('--max-credits') + 1] = '99.000000001'
    await expect(h.invoke('python', args)).rejects.toMatchObject({ status: 502 })
    expect(h.requests).toHaveLength(1)
    const replay = harness([{ run: { ...run, idempotencyKey: 'different-analysis-key' } }])
    await expect(replay.invoke('python', submitArgs())).rejects.toMatchObject({ status: 502 })
    expect(replay.receipts()).toEqual([])
  })
})
