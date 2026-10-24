import { describe, expect, it } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/index'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const org = `org_${suffix}`
const fileId = `doc_${suffix}`
const modelId = `doc_01m2k72d22fqe8ww472ycs3px4`
const revisionId = `frev_${suffix}`
const runId = `scrun_${suffix}`
const env = { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'private-token' }
const OUTPUT = { contractVersion: 1, kind: 'json', schema: { mode: 'open' } }
const declaration = {
  projectId: null,
  parameters: { horizon: 4 },
  bindings: [{ kind: 'file', name: 'model', sourceId: modelId, fileId: modelId, revisionId }],
  dependencies: [],
  outputs: [{ slot: 'result', required: true, contract: OUTPUT }],
  seed: null,
}
const quote = {
  payer: { organizationId: org, userId: `user_${suffix}`, membershipId: `member_${suffix}` },
  maximumCredits: '2',
  funding: {
    kind: 'shared_manual',
    availableOrganizationCredits: '90',
    split: { organizationCredits: '2', personalCredits: '0', referralCredits: '0' },
  },
  tariffVersion: 'compute-v1',
  reservedMemoryMiB: 2048,
}
const run = (status: string, stopReason: string | null = null) => ({
  id: runId,
  sourceFileId: fileId,
  sourceRevisionId: revisionId,
  status,
  stopReason,
  requiredSlots: ['result'],
  createdAt: '2026-10-22T09:00:00.000Z',
  completedAt: status === 'queued' ? null : '2026-10-22T09:01:00.000Z',
})

interface Sent {
  method: string
  path: string
  body: unknown
}

/** A fake Teler API answering each `METHOD /path` (query excluded), and the requests it got. */
function server(routes: Record<string, () => Response>) {
  const sent: Sent[] = []
  const fetch = async (url: string, init?: RequestInit) => {
    const parsed = new URL(url)
    const method = init?.method ?? 'GET'
    sent.push({
      method,
      path: parsed.pathname + parsed.search,
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
    })
    const route = routes[`${method} ${parsed.pathname}`]
    return route ? route() : Response.json({ code: 'NOT_FOUND' }, { status: 404 })
  }
  return { fetch, sent }
}

async function cli(argv: string[], fetch: ReturnType<typeof server>['fetch']) {
  let stdout = ''
  let stderr = ''
  const exitCode = await main(argv, {
    env,
    fetch,
    writeOut: (text) => (stdout += text),
    writeErr: (text) => (stderr += text),
  })
  return { exitCode, stdout, stderr }
}

async function localFile(name: string, text: string): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), 'teler-code-')), name)
  await writeFile(path, text)
  return path
}

describe('teler files save-code', () => {
  it('saves a script as a runnable File whose contract names its resolved inputs in order', async () => {
    const code = await localFile('score.py', 'import teler.job\n')
    const api = server({
      'POST /api/schedule/files/inputs': () => Response.json({ bindings: declaration.bindings }),
      'POST /api/files/save-content': () =>
        Response.json({ fileId, revisionId, version: 1, kind: 'source' }, { status: 201 }),
    })
    const result = await cli(
      [
        'files',
        'save-code',
        code,
        '--to',
        '/personal/jobs/score.py',
        '--input',
        `model=file:${modelId}`,
        '--org',
        org,
        '--json',
      ],
      api.fetch
    )
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      fileId,
      revisionId,
      version: 1,
      bindings: declaration.bindings,
    })
    expect(api.sent[0]).toEqual({
      method: 'POST',
      path: '/api/schedule/files/inputs',
      body: {
        organizationId: org,
        projectId: null,
        inputs: [{ kind: 'file', name: 'model', fileId: modelId }],
      },
    })
    const save = api.sent[1]?.body as Record<string, unknown>
    expect(api.sent[1]?.path).toBe(`/api/files/save-content?organizationId=${org}`)
    expect(save).toMatchObject({
      destination: {
        kind: 'create',
        scope: 'personal',
        path: '/personal/jobs/score.py',
        name: 'score.py',
      },
      contract: {
        kind: 'source',
        language: 'python',
        execution: {
          entrypoint: '__main__',
          runtimeId: 'python-sandbox-v1',
          inputSchema: { type: 'object' },
          bindingSourceIds: [modelId],
        },
      },
      source: { text: 'import teler.job\n' },
    })
  })

  it('saves a new version at the version and access it read, and needs exactly one place', async () => {
    const code = await localFile('score.py', 'print(1)\n')
    const api = server({
      'GET /api/files/doc_01m2k72d22fqe8ww472ycs3px3/content-descriptor': () =>
        Response.json({ revisionId, version: 3, securityVersion: 2 }),
      'POST /api/files/save-content': () =>
        Response.json({ fileId, revisionId, version: 4 }, { status: 201 }),
    })
    const saved = await cli(['files', 'save-code', code, '--file', fileId, '--org', org], api.fetch)
    expect(saved).toMatchObject({
      exitCode: 0,
      stdout: `Saved ${fileId} version 4 (${revisionId})\n`,
    })
    expect(api.sent[1]?.body).toMatchObject({
      destination: { kind: 'revise', fileId, expectedVersion: 3, expectedSecurityVersion: 2 },
    })
    for (const place of [[], ['--to', '/personal/a.py', '--file', fileId], ['--to', '/tmp/a.py']]) {
      const refused = await cli(['files', 'save-code', code, ...place, '--org', org], api.fetch)
      expect(refused.exitCode).toBe(2)
    }
  })
})

describe('teler files run and result', () => {
  it('quotes and runs the current version with the last run’s declaration, then prints its output', async () => {
    const api = server({
      'GET /api/files/doc_01m2k72d22fqe8ww472ycs3px3/content-descriptor': () =>
        Response.json({ revisionId, version: 1, securityVersion: 1 }),
      'GET /api/schedule/files/run-declaration': () =>
        Response.json({
          fileId,
          revisionId,
          declaration,
          source: 'run',
          schedule: { available: true },
          runNow: { available: true },
        }),
      'GET /api/saved-code-runs/tariff': () => Response.json({ tariffVersion: 'compute-v1' }),
      'POST /api/saved-code-runs/preflight': () => Response.json(quote),
      'POST /api/saved-code-runs': () => Response.json(run('succeeded'), { status: 202 }),
      'GET /api/saved-code-runs/scrun_01m2k72d22fqe8ww472ycs3px3/outputs/result': () =>
        new Response('{"forecast":[1,2]}', {
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
    })
    const argv = ['files', 'run', fileId, '--max-credits', '2', '--idempotency-key']
    const first = await cli([...argv, 'weekly-forecast-0001', '--org', org, '--json'], api.fetch)
    expect(first.exitCode).toBe(0)
    expect(JSON.parse(first.stdout)).toMatchObject({
      id: runId,
      status: 'succeeded',
      outputs: { result: { forecast: [1, 2] } },
    })
    expect(
      api.sent.find((sent) => sent.path.startsWith('/api/saved-code-runs/preflight'))?.body
    ).toEqual({
      maximumCredits: '2',
      tariffVersion: 'compute-v1',
    })
    const submitted = api.sent.find(
      (sent) => sent.path === `/api/saved-code-runs?organizationId=${org}`
    )?.body as Record<string, string>
    expect(submitted).toMatchObject({
      sourceFileId: fileId,
      sourceRevisionId: revisionId,
      purpose: 'production',
      ...declaration,
      maximumCredits: '2',
      approvedFunding: quote.funding,
      approvedPayer: quote.payer,
      approvedReservedMemoryMiB: 2048,
    })
    expect(submitted.idempotencyKey).toMatch(/^[0-9a-f]{64}$/)
    expect(Number.isNaN(Date.parse(submitted.occurrenceAt))).toBe(false)
  })

  it('quotes a run in the project it names, from the last run or from --project', async () => {
    const projectId = `prj_${suffix}`
    const lastRun = { ...declaration, projectId }
    const api = server({
      'GET /api/files/doc_01m2k72d22fqe8ww472ycs3px3/content-descriptor': () =>
        Response.json({ revisionId, version: 1, securityVersion: 1 }),
      'GET /api/schedule/files/run-declaration': () =>
        Response.json({
          revisionId,
          declaration: lastRun,
          schedule: { available: true },
          runNow: { available: true },
        }),
      'POST /api/schedule/files/inputs': () => Response.json({ bindings: declaration.bindings }),
      'GET /api/saved-code-runs/tariff': () => Response.json({ tariffVersion: 'compute-v1' }),
      'POST /api/saved-code-runs/preflight': () => Response.json(quote),
      'POST /api/saved-code-runs': () => Response.json(run('queued'), { status: 202 }),
    })
    const base = ['files', 'run', fileId, '--max-credits', '2', '--org', org]
    const flags = ['--project', projectId, '--output', 'result']
    for (const [key, declared] of [
      ['project-quote-0001', []],
      ['project-quote-0002', flags],
    ] as const) {
      api.sent.length = 0
      const result = await cli([...base, '--idempotency-key', key, ...declared], api.fetch)
      expect(result.exitCode).toBe(0)
      const body = (prefix: string) => api.sent.find((sent) => sent.path.startsWith(prefix))?.body
      expect(body('/api/saved-code-runs/preflight')).toEqual({
        maximumCredits: '2',
        tariffVersion: 'compute-v1',
        projectId,
      })
      expect(body(`/api/saved-code-runs?`)).toMatchObject({ projectId })
    }
  })

  it('declares outputs and inputs from flags, and refuses several outputs without result', async () => {
    const api = server({
      'GET /api/files/doc_01m2k72d22fqe8ww472ycs3px3/content-descriptor': () =>
        Response.json({ revisionId, version: 1, securityVersion: 1 }),
      'POST /api/schedule/files/inputs': () => Response.json({ bindings: declaration.bindings }),
      'GET /api/saved-code-runs/tariff': () => Response.json({ tariffVersion: 'compute-v1' }),
      'POST /api/saved-code-runs/preflight': () => Response.json(quote),
      'POST /api/saved-code-runs': () => Response.json(run('queued'), { status: 202 }),
    })
    const base = ['files', 'run', fileId, '--max-credits', '2', '--org', org]
    const queued = await cli(
      [
        ...base,
        '--idempotency-key',
        'weekly-forecast-0002',
        '--output',
        'result',
        '--input',
        `model=file:${modelId}`,
        '--params',
        '{"horizon":4}',
      ],
      api.fetch
    )
    expect(queued).toMatchObject({ exitCode: 0, stdout: `${runId}\tqueued\n` })
    expect(
      api.sent.some((sent) => sent.path.startsWith('/api/schedule/files/run-declaration'))
    ).toBe(false)
    expect(api.sent.at(-1)?.body).toMatchObject({
      parameters: { horizon: 4 },
      bindings: declaration.bindings,
      outputs: [{ slot: 'result', required: true, contract: OUTPUT }],
    })
    const several = await cli(
      [...base, '--idempotency-key', 'weekly-forecast-0003', '--output', 'a', '--output', 'b'],
      api.fetch
    )
    expect(several.exitCode).toBe(2)
  })

  it('names the next step when a File has no declaration, the plan is Free or a key was reused', async () => {
    const descriptor = () => Response.json({ revisionId, version: 1, securityVersion: 1 })
    const refusals: Array<[Record<string, () => Response>, string, string]> = [
      [
        {
          'GET /api/schedule/files/run-declaration': () =>
            Response.json({
              revisionId,
              declaration: null,
              schedule: { available: false, reason: 'NO_OUTPUT_CONTRACT' },
              runNow: { available: false, reason: 'NO_OUTPUT_CONTRACT' },
            }),
        },
        'NO_OUTPUT_CONTRACT',
        '--output <slot>',
      ],
      [
        {
          'POST /api/schedule/files/inputs': () => Response.json({ bindings: [] }),
          'GET /api/saved-code-runs/tariff': () => Response.json({ tariffVersion: 'compute-v1' }),
          'POST /api/saved-code-runs/preflight': () =>
            Response.json({ error: 'Plan', code: 'PLAN_REQUIRED', plan: 'free' }, { status: 403 }),
        },
        'PLAN_REQUIRED',
        'plan',
      ],
      [
        {
          'GET /api/saved-code-runs/tariff': () => Response.json({ tariffVersion: 'compute-v1' }),
          'POST /api/saved-code-runs/preflight': () => Response.json(quote),
          'POST /api/saved-code-runs': () =>
            Response.json(
              { error: { code: 'RETRY_CONFLICT', message: 'RETRY_CONFLICT', retryable: false } },
              { status: 409 }
            ),
        },
        'RETRY_CONFLICT',
        'nothing new ran',
      ],
    ]
    for (const [routes, code, hint] of refusals) {
      const api = server({
        'GET /api/files/doc_01m2k72d22fqe8ww472ycs3px3/content-descriptor': descriptor,
        ...routes,
      })
      const argv = ['files', 'run', fileId, '--max-credits', '2', '--idempotency-key']
      const flags = code === 'NO_OUTPUT_CONTRACT' ? [] : ['--output', 'result']
      const result = await cli(
        [...argv, 'key-for-refusal-001', ...flags, '--org', org, '--json'],
        api.fetch
      )
      expect(result.exitCode).toBe(1)
      const { error } = JSON.parse(result.stderr) as { error: { code: string; hint: string } }
      expect(error.code).toBe(code)
      expect(error.hint).toContain(hint)
    }
  })

  it('reads a run’s result, and says how to see why saved code failed', async () => {
    const api = server({
      'GET /api/saved-code-runs/scrun_01m2k72d22fqe8ww472ycs3px3': () =>
        Response.json(run('failed', 'execution_failed')),
    })
    // Reading a failed run succeeds; waiting for one that fails does not.
    const read = await cli(['files', 'result', runId, '--org', org, '--json'], api.fetch)
    expect(read).toMatchObject({ exitCode: 0, stderr: '' })
    const result = await cli(
      ['files', 'result', runId, '--wait', '--org', org, '--json'],
      api.fetch
    )
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout.split('\n')[0] ?? '')).toMatchObject({
      status: 'failed',
      stopReason: 'execution_failed',
      outputs: {},
    })
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: 'RUN_FAILED', hint: expect.stringContaining('teler run python') },
    })
  })
})

describe('teler files, after review', () => {
  it('says a reused run key ran nothing new, without promising a replay', async () => {
    const api = server({
      'GET /api/files/doc_01m2k72d22fqe8ww472ycs3px3/content-descriptor': () =>
        Response.json({ revisionId, version: 1, securityVersion: 1 }),
      'GET /api/saved-code-runs/tariff': () => Response.json({ tariffVersion: 'compute-v1' }),
      'POST /api/saved-code-runs/preflight': () => Response.json(quote),
      'POST /api/saved-code-runs': () =>
        Response.json({ error: { code: 'RETRY_CONFLICT' } }, { status: 409 }),
    })
    const result = await cli(
      [
        'files',
        'run',
        fileId,
        '--max-credits',
        '2',
        '--idempotency-key',
        'key-for-refusal-002',
        '--output',
        'result',
        '--org',
        org,
      ],
      api.fetch
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('nothing new ran')
    expect(result.stderr).not.toContain('belongs to a different task')
  })

  it('refuses run flags on save-code instead of ignoring them', async () => {
    const code = await localFile('score.py', 'print(1)\n')
    const result = await cli(
      ['files', 'save-code', code, '--to', '/personal/a.py', '--params', '{}', '--org', org],
      server({}).fetch
    )
    expect(result.exitCode).toBe(2)
  })
})

describe('teler files runs and output', () => {
  const runPath = '/api/saved-code-runs/scrun_01m2k72d22fqe8ww472ycs3px3'

  it('lists code runs, newest first, with a cursor for the next page', async () => {
    const listed = {
      ...run('succeeded'),
      streamSha256: 'a'.repeat(64),
      occurrenceAt: '2026-10-22T09:00:00.000Z',
    }
    const api = server({
      'GET /api/saved-code-runs': () =>
        Response.json({ items: [listed], hasMore: true, nextCursor: 'next-page' }),
    })
    const result = await cli(['files', 'runs', '--limit', '1', '--org', org], api.fetch)
    expect(result.stdout).toBe(
      `${runId}\tsucceeded\t${fileId}\t2026-10-22T09:00:00.000Z\nMore: teler files runs --cursor next-page\n`
    )
    expect(api.sent[0]?.path).toBe(`/api/saved-code-runs?organizationId=${org}&limit=1`)
  })

  it('prints a JSON output, refuses to print binary bytes and saves any output to a new file', async () => {
    const api = server({
      [`GET ${runPath}/outputs/result`]: () =>
        new Response('[{"week":13,"units":191.5}]', {
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }),
      [`GET ${runPath}/outputs/model`]: () =>
        new Response(new Uint8Array([128, 4, 149]), {
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
    })
    const printed = await cli(
      ['files', 'output', runId, 'result', '--org', org, '--json'],
      api.fetch
    )
    expect(JSON.parse(printed.stdout)).toEqual({
      runId,
      slot: 'result',
      value: [{ week: 13, units: 191.5 }],
    })
    const binary = await cli(['files', 'output', runId, 'model', '--org', org], api.fetch)
    expect(binary.exitCode).toBe(2)
    const target = join(await mkdtemp(join(tmpdir(), 'teler-output-')), 'model.joblib')
    const saved = await cli(
      ['files', 'output', runId, 'model', '--output', target, '--org', org],
      api.fetch
    )
    expect(saved).toMatchObject({ exitCode: 0, stdout: `Saved model to ${target}\n` })
    expect([...new Uint8Array(await Bun.file(target).arrayBuffer())]).toEqual([128, 4, 149])
    const again = await cli(
      ['files', 'output', runId, 'model', '--output', target, '--org', org],
      api.fetch
    )
    expect(again.exitCode).toBe(2)
  })

  it('reports a binary output of a result by its size, not its bytes', async () => {
    const api = server({
      [`GET ${runPath}`]: () => Response.json({ ...run('succeeded'), requiredSlots: ['model'] }),
      [`GET ${runPath}/outputs/model`]: () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
    })
    const result = await cli(['files', 'result', runId, '--org', org, '--json'], api.fetch)
    expect(JSON.parse(result.stdout)).toMatchObject({
      outputs: { model: { mediaType: 'application/octet-stream', byteLength: 4 } },
    })
  })
})

describe('teler files result for a person', () => {
  it('prints JSON output values, bounded, and names binary outputs by size', async () => {
    const runPath = '/api/saved-code-runs/scrun_01m2k72d22fqe8ww472ycs3px3'
    const api = server({
      [`GET ${runPath}`]: () =>
        Response.json({ ...run('succeeded'), requiredSlots: ['result', 'model'] }),
      [`GET ${runPath}/outputs/result`]: () =>
        new Response('{"forecast":[191.5,198.5],"note":"ok\\u001b[2J"}', {
          headers: { 'Content-Type': 'application/json' },
        }),
      [`GET ${runPath}/outputs/model`]: () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
    })
    const result = await cli(['files', 'result', runId, '--org', org], api.fetch)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      'output\tresult\t{"forecast":[191.5,198.5],"note":"ok\\u001b[2J"}'
    )
    expect(result.stdout).toContain('output\tmodel\tbinary, 3 bytes')
    expect(result.stdout).not.toContain('\u001b')
  })
})
