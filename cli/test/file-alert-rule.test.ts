import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const org = `org_${suffix}`
const fileId = `doc_${suffix}`
const revisionId = `frev_${suffix}`
const id = `sched_${suffix}`
const env = { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'private-token' }
const OUTPUT = { contractVersion: 1, kind: 'json', schema: { mode: 'open' } }
const RULE = 'Weekly sales fall below 100 units'
const lastRun = {
  projectId: null,
  parameters: {},
  bindings: [],
  dependencies: [],
  outputs: [{ slot: 'result', required: true, contract: OUTPUT }],
  seed: null,
  alertRule: RULE,
}
const schedule = {
  id,
  targetKind: 'file',
  organizationId: org,
  projectId: null,
  fileId,
  revisionId,
  frequency: 'daily',
  time: '06:00',
  timezone: 'UTC',
  dayOfWeek: null,
  dayOfMonth: null,
  isPaused: true,
  pauseReason: null,
  nextRunAt: '2026-10-26T06:00:00.000Z',
  definitionRevision: 1,
  needsSpendApproval: true,
  spend: null,
  heldByAdmin: false,
}

interface Sent {
  method: string
  path: string
  query: string
  body: unknown
}

function server(declared: typeof lastRun | Omit<typeof lastRun, 'alertRule'>) {
  const sent: Sent[] = []
  const routes: Record<string, () => Response> = {
    [`GET /api/files/${fileId}/content-descriptor`]: () =>
      Response.json({ revisionId, version: 2, securityVersion: 1 }),
    'GET /api/schedule/files/run-declaration': () =>
      Response.json({
        revisionId,
        declaration: declared,
        schedule: { available: true },
        runNow: { available: true },
      }),
    'POST /api/schedule/files': () => Response.json(schedule, { status: 201 }),
    [`GET /api/schedule/${id}`]: () => Response.json({ ...schedule, alertRule: RULE }),
  }
  const fetch = async (url: string, init?: RequestInit) => {
    const parsed = new URL(url)
    const method = init?.method ?? 'GET'
    sent.push({
      method,
      path: parsed.pathname,
      query: parsed.search,
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

const create = [
  'schedule',
  'file',
  'create',
  fileId,
  '--frequency',
  'daily',
  '--time-utc',
  '06:00',
  '--idempotency-key',
  'alerting-file-0001',
  '--org',
  org,
]
const created = (sent: Sent[]) =>
  sent.find((call) => call.method === 'POST' && call.path === '/api/schedule/files')?.body as
    { target: Record<string, unknown> } | undefined

describe('a File that alerts', () => {
  it('keeps its alert rule when the schedule repeats the last run', async () => {
    const api = server(lastRun)
    expect((await cli(create, api.fetch)).exitCode).toBe(0)
    expect(created(api.sent)?.target.alertRule).toBe(RULE)
  })

  it('sends the rule passed with --alert-rule beside the outputs named with --output', async () => {
    const api = server(lastRun)
    const result = await cli([...create, '--output', 'result', '--alert-rule', RULE], api.fetch)
    expect(result.exitCode).toBe(0)
    expect(created(api.sent)?.target).toMatchObject({
      outputs: [{ slot: 'result', required: true, contract: OUTPUT }],
      alertRule: RULE,
    })
  })

  it('refuses --output without --alert-rule rather than drop the rule it alerts by', async () => {
    const api = server(lastRun)
    const result = await cli([...create, '--output', 'result', '--json'], api.fetch)
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).error).toMatchObject({ code: 'ALERT_RULE_REQUIRED' })
    expect(JSON.parse(result.stderr).error.hint).toContain('--alert-rule')
    expect(created(api.sent)).toBeUndefined()

    const run = await cli(
      [
        'files',
        'run',
        fileId,
        '--max-credits',
        '2',
        '--idempotency-key',
        'alerting-run-0001',
        '--output',
        'result',
        '--org',
        org,
      ],
      api.fetch
    )
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('--alert-rule')
    expect(api.sent.some((call) => call.path.startsWith('/api/saved-code-runs'))).toBe(false)
  })

  it('finds the rule from a run in any project, not only the one --project names', async () => {
    const api = server(lastRun)
    const result = await cli(
      [...create, '--output', 'result', '--project', `prj_${suffix}`],
      api.fetch
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--alert-rule')
    const read = api.sent.find((call) => call.path === '/api/schedule/files/run-declaration')
    expect(read?.query).not.toContain('projectId')
  })

  it('schedules --output as before for a File that does not alert', async () => {
    const { alertRule: _none, ...quiet } = lastRun
    const api = server(quiet)
    expect((await cli([...create, '--output', 'result'], api.fetch)).exitCode).toBe(0)
    expect(created(api.sent)?.target).not.toHaveProperty('alertRule')
  })

  it('refuses a rule that is empty, too long or more than one line', async () => {
    for (const rule of ['   ', 'x'.repeat(281), 'first line\nsecond line', 'tab\there']) {
      const api = server(lastRun)
      const result = await cli([...create, '--output', 'result', '--alert-rule', rule], api.fetch)
      expect(result.exitCode).toBe(2)
      expect(api.sent).toEqual([])
    }
  })

  it('shows the rule a File schedule alerts by', async () => {
    const api = server(lastRun)
    const shown = await cli(['schedule', 'file', 'show', id], api.fetch)
    expect(shown.stdout).toBe(
      `File schedule ${id} (revision 1): paused until its spend is approved; alerts when ${RULE}\n`
    )
    const json = await cli(['schedule', 'file', 'show', id, '--json'], api.fetch)
    expect(JSON.parse(json.stdout).alertRule).toBe(RULE)
  })
})
