import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const org = `org_${suffix}`
const fileId = `doc_${suffix}`
const revisionId = `frev_${suffix}`
const id = `sched_${suffix}`
const env = { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'private-token' }
const OUTPUT = { contractVersion: 1, kind: 'json', schema: { mode: 'open' } }
const declaration = {
  projectId: `prj_${suffix}`,
  parameters: {},
  bindings: [],
  dependencies: [],
  outputs: [{ slot: 'result', required: true, contract: OUTPUT }],
  seed: null,
}
const spend = {
  status: 'active',
  fundingKind: 'shared_automatic',
  maxRunMillis: 300_000,
  maximumCreditsPerOccurrence: '1.25',
  maximumCreditsPerMonth: '20',
  monthToDateCredits: '0',
  expiresAt: '2027-10-22T09:00:00.000Z',
  personalFallback: null,
}
const schedule = (overrides: Record<string, unknown> = {}) => ({
  id,
  targetKind: 'file',
  organizationId: org,
  projectId: declaration.projectId,
  fileId,
  revisionId,
  frequency: 'daily',
  time: '06:00',
  timezone: 'Europe/Madrid',
  dayOfWeek: null,
  dayOfMonth: null,
  isPaused: true,
  pauseReason: null,
  nextRunAt: '2026-10-23T04:00:00.000Z',
  definitionRevision: 1,
  createdAt: '2026-10-22T09:00:00.000Z',
  updatedAt: '2026-10-22T09:00:00.000Z',
  needsSpendApproval: true,
  spend: null,
  heldByAdmin: false,
  ...overrides,
})
const quote = {
  tariffVersion: 'compute-v1',
  maxRunMillis: 300_000,
  maximumCreditsPerOccurrence: '1.25',
  expectedOccurrencesPerMonth: 30.44,
  worstCaseOccurrencesPerMonth: 31,
  suggestedMaximumCreditsPerMonth: '58',
  measuredRunMillis: null,
  measuredCreditsPerRun: null,
  monthToDateCredits: '0',
  fundingKind: 'shared_automatic',
  computeIncluded: false,
  expiresAt: '2027-10-22T09:00:00.000Z',
  configSha256: 'c'.repeat(64),
  definitionRevision: 1,
  authorization: null,
}

interface Sent {
  method: string
  path: string
  body: unknown
}

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

const base = `/api/schedule/${id}`
const approve = ['schedule', 'file', 'approve', id, '--revision', '1', '--monthly-credits']

describe('teler schedule file', () => {
  it('schedules the current version with the last run’s declaration, paused, in local time', async () => {
    const api = server({
      'GET /api/files/doc_01m2k72d22fqe8ww472ycs3px3/content-descriptor': () =>
        Response.json({ revisionId, version: 2, securityVersion: 1 }),
      'GET /api/schedule/files/run-declaration': () =>
        Response.json({
          revisionId,
          declaration,
          schedule: { available: true },
          runNow: { available: true },
        }),
      'POST /api/schedule/files': () => Response.json(schedule(), { status: 201 }),
    })
    const created = await cli(
      [
        'schedule',
        'file',
        'create',
        fileId,
        '--frequency',
        'daily',
        '--time',
        '06:00',
        '--timezone',
        'Europe/Madrid',
        '--idempotency-key',
        'daily-forecast-schedule-1',
        '--org',
        org,
      ],
      api.fetch
    )
    expect(created.exitCode).toBe(0)
    expect(created.stdout).toContain(
      `Created ${id} (revision 1): paused until its spend is approved`
    )
    expect(created.stdout).toContain(`teler schedule file quote ${id}`)
    const { projectId, ...target } = declaration
    expect(api.sent.at(-1)).toEqual({
      method: 'POST',
      path: '/api/schedule/files',
      body: {
        organizationId: org,
        projectId,
        operationKey: 'daily-forecast-schedule-1',
        frequency: 'daily',
        time: '06:00',
        timezone: 'Europe/Madrid',
        target: { fileId, revisionId, ...target },
      },
    })
  })

  it('approves exactly the quote at the revision it names, capped, and only with --yes', async () => {
    const api = server({
      [`POST ${base}/spend/prepare`]: () => Response.json(quote),
      [`POST ${base}/spend/approve`]: () =>
        Response.json(
          schedule({ isPaused: false, needsSpendApproval: false, spend, definitionRevision: 2 }),
          { status: 201 }
        ),
    })
    expect((await cli([...approve, '20'], api.fetch)).exitCode).toBe(2)
    expect((await cli([...approve, '1', '--yes'], api.fetch)).exitCode).toBe(2)
    expect(api.sent.every((sent) => !sent.path.endsWith('/spend/approve'))).toBe(true)

    const approved = await cli([...approve, '20', '--yes'], api.fetch)
    expect(approved.exitCode).toBe(0)
    expect(approved.stdout).toContain(`Approved ${id}: up to 1.25 credits a run and 20 a month`)
    const bodies = api.sent.filter((sent) => sent.path.endsWith('/spend/approve'))
    expect(bodies[0]?.body).toMatchObject({
      expectedRevision: 1,
      maxRunMillis: 300_000,
      maximumCreditsPerOccurrence: '1.25',
      maximumCreditsPerMonth: '20',
      personalFallback: null,
      tariffVersion: 'compute-v1',
      configSha256: 'c'.repeat(64),
      computeIncluded: false,
    })
    // The same approval sent again is the same operation, so the server replays it.
    await cli([...approve, '20', '--yes'], api.fetch)
    const keys = api.sent
      .filter((sent) => sent.path.endsWith('/spend/approve'))
      .map((sent) => (sent.body as { operationKey: string }).operationKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1] ?? '')
    expect(keys[0]).toMatch(/^cli-approve-[0-9a-f]{64}$/)
  })

  it('refuses a quote that moved on, locally or from the server, with the next step', async () => {
    const moved = server({
      [`POST ${base}/spend/prepare`]: () => Response.json({ ...quote, definitionRevision: 2 }),
      [`GET ${base}`]: () => Response.json(schedule({ definitionRevision: 2 })),
    })
    const local = await cli([...approve, '20', '--yes', '--json'], moved.fetch)
    expect(local.exitCode).toBe(1)
    expect(JSON.parse(local.stderr)).toMatchObject({ error: { code: 'STALE_QUOTE' } })
    expect(moved.sent.every((sent) => !sent.path.endsWith('/spend/approve'))).toBe(true)

    const stale = server({
      [`POST ${base}/spend/prepare`]: () => Response.json(quote),
      [`POST ${base}/spend/approve`]: () =>
        Response.json(
          {
            error: 'Schedule activation refused',
            code: 'SCHEDULE_REFUSED',
            reason: 'STALE_APPROVAL',
          },
          { status: 409 }
        ),
    })
    const remote = await cli([...approve, '20', '--yes', '--json'], stale.fetch)
    expect(remote.exitCode).toBe(1)
    expect(JSON.parse(remote.stderr)).toMatchObject({
      error: {
        code: 'SCHEDULE_REFUSED',
        reason: 'STALE_APPROVAL',
        hint: expect.stringContaining('teler schedule file quote'),
      },
    })
  })

  it('pauses, resumes, re-pins and deletes at the revision it read, never blind', async () => {
    const api = server({
      [`GET ${base}`]: () => Response.json(schedule({ definitionRevision: 4 })),
      [`PATCH ${base}`]: () => Response.json(schedule({ definitionRevision: 5 })),
      [`POST ${base}/file/re-pin`]: () => Response.json(schedule({ definitionRevision: 5 })),
      [`DELETE ${base}`]: () => new Response(null, { status: 204 }),
    })
    for (const action of ['pause', 'resume', 're-pin'])
      expect((await cli(['schedule', 'file', action, id], api.fetch)).exitCode).toBe(0)
    expect((await cli(['schedule', 'file', 'delete', id], api.fetch)).exitCode).toBe(2)
    expect((await cli(['schedule', 'file', 'delete', id, '--yes'], api.fetch)).exitCode).toBe(0)
    expect(api.sent.filter((sent) => sent.method !== 'GET')).toEqual([
      { method: 'PATCH', path: base, body: { isPaused: true, expectedRevision: 4 } },
      { method: 'PATCH', path: base, body: { isPaused: false, expectedRevision: 4 } },
      { method: 'POST', path: `${base}/file/re-pin`, body: { expectedRevision: 4 } },
      { method: 'DELETE', path: `${base}?expectedRevision=4`, body: undefined },
    ])
  })

  it('says how to start a schedule whose spend is not approved', async () => {
    const api = server({
      [`GET ${base}`]: () => Response.json(schedule()),
      [`PATCH ${base}`]: () =>
        Response.json(
          { error: 'Refused', code: 'SCHEDULE_REFUSED', reason: 'SPEND_APPROVAL_REQUIRED' },
          { status: 409 }
        ),
    })
    const result = await cli(['schedule', 'file', 'resume', id], api.fetch)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('SPEND_APPROVAL_REQUIRED')
    expect(result.stderr).toContain('hint: Approve its monthly spend first')
  })

  it('lists runs with their code run and a skip code, never the server’s free text', async () => {
    const occurrence = {
      id: `srun_${suffix}`,
      scheduledQueryId: id,
      status: 'skipped',
      agentRunId: null,
      agentRunStatus: null,
      chatId: null,
      taskId: null,
      taskStatus: null,
      scheduledFor: '2026-10-23T04:00:00.000Z',
      executedAt: '2026-10-23T04:00:01.000Z',
      savedCodeRunId: null,
      savedCodeRunStatus: null,
      attempts: 0,
      settledAt: null,
    }
    const api = server({
      [`GET ${base}/history`]: () =>
        Response.json({
          runs: [
            { ...occurrence, errorMessage: 'SPEND_CAP_REACHED' },
            { ...occurrence, errorMessage: 'private-token https://private/db?password=x' },
          ],
        }),
    })
    const result = await cli(['schedule', 'file', 'runs', id, '--json'], api.fetch)
    expect(result.exitCode).toBe(0)
    const { runs } = JSON.parse(result.stdout) as { runs: Array<Record<string, unknown>> }
    expect(runs.map((run) => run.reason)).toEqual(['SPEND_CAP_REACHED', null])
    expect(result.stdout).not.toContain('private')
  })

  it('shows only File schedules, and lists them beside Agent schedules', async () => {
    const agentSchedule = server({
      [`GET ${base}`]: () => Response.json({ id, agentId: `agent_${suffix}`, frequency: 'daily' }),
    })
    const notFile = await cli(['schedule', 'file', 'show', id, '--json'], agentSchedule.fetch)
    expect(JSON.parse(notFile.stderr)).toMatchObject({ error: { code: 'NOT_A_FILE_SCHEDULE' } })

    const list = server({
      'GET /api/schedule': () =>
        Response.json({ schedules: [], eventStarts: [], fileSchedules: [schedule()] }),
    })
    const listed = await cli(['schedule', 'list', '--org', org], list.fetch)
    expect(listed.stdout).toBe(`${id}\tfile ${fileId}\tpaused\n`)
  })
})

describe('teler schedule file, after review', () => {
  const selfPaused = {
    kind: 'upload_missing',
    input: 'sales',
    upload: 'sales.csv',
  }

  it('reads a schedule that paused itself for an upload, and still lists every schedule', async () => {
    const api = server({
      [`GET ${base}`]: () => Response.json(schedule({ pauseReason: selfPaused })),
      'GET /api/schedule': () =>
        Response.json({
          schedules: [],
          eventStarts: [],
          fileSchedules: [schedule({ pauseReason: selfPaused, futureField: { a: 1 } })],
        }),
    })
    const shown = await cli(['schedule', 'file', 'show', id], api.fetch)
    expect(shown.exitCode).toBe(0)
    expect(shown.stdout).toContain('paused (upload_missing)')
    expect(shown.stdout).not.toContain('sales.csv')
    const listed = await cli(['schedule', 'list', '--org', org], api.fetch)
    expect(listed).toMatchObject({ exitCode: 0, stdout: `${id}\tfile ${fileId}\tpaused\n` })
  })

  it('reports an approval that already went through instead of a stale quote', async () => {
    const api = server({
      [`POST ${base}/spend/prepare`]: () => Response.json({ ...quote, definitionRevision: 2 }),
      [`GET ${base}`]: () =>
        Response.json(
          schedule({ isPaused: false, needsSpendApproval: false, spend, definitionRevision: 2 })
        ),
    })
    const again = await cli([...approve, '20', '--yes'], api.fetch)
    expect(again.exitCode).toBe(0)
    expect(again.stdout).toContain(`${id} is already approved`)
    expect(api.sent.every((sent) => !sent.path.endsWith('/spend/approve'))).toBe(true)
    const other = await cli([...approve, '30', '--yes', '--json'], api.fetch)
    expect(JSON.parse(other.stderr)).toMatchObject({ error: { code: 'STALE_QUOTE' } })
    // Moved on again since (a pause, a hold): the live approval is not this one.
    const later = server({
      [`POST ${base}/spend/prepare`]: () => Response.json({ ...quote, definitionRevision: 3 }),
      [`GET ${base}`]: () =>
        Response.json(schedule({ needsSpendApproval: false, spend, definitionRevision: 3 })),
    })
    const moved = await cli([...approve, '20', '--yes', '--json'], later.fetch)
    expect(JSON.parse(moved.stderr)).toMatchObject({ error: { code: 'STALE_QUOTE' } })
  })

  it('keeps the run time a quote was asked for in the approve command it suggests', async () => {
    const api = server({
      [`POST ${base}/spend/prepare`]: () => Response.json({ ...quote, maxRunMillis: 1_200_000 }),
    })
    const quoted = await cli(
      ['schedule', 'file', 'quote', id, '--max-run-minutes', '20'],
      api.fetch
    )
    expect(quoted.stdout).toContain('--max-run-minutes 20 --yes')
    expect(api.sent[0]?.body).toEqual({ maxRunMillis: 1_200_000 })
  })

  it('needs a time zone with a local time, and words an approval without spend plainly', async () => {
    const refused = await cli(
      [
        'schedule',
        'file',
        'create',
        fileId,
        '--frequency',
        'daily',
        '--time',
        '06:00',
        '--idempotency-key',
        'daily-forecast-schedule-1',
      ],
      server({}).fetch
    )
    expect(refused.exitCode).toBe(2)
    const api = server({
      [`POST ${base}/spend/prepare`]: () => Response.json(quote),
      [`POST ${base}/spend/approve`]: () => Response.json(schedule(), { status: 201 }),
    })
    const approved = await cli([...approve, '20', '--yes'], api.fetch)
    expect(approved.stdout).not.toContain('undefined')
  })
})
