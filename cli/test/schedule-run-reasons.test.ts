import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'
import { SCHEDULE_RUN_REASON_TEXT, scheduleRunReasonText } from '../src/schedule-run-reasons'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const id = `sched_${suffix}`
const at = '2026-10-23T04:00:00.000Z'
const env = { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'private-token' }

const CREDIT_CHECK = "Teler couldn't check your credits, so this run was skipped. We're on it."
const AUTOMATIC_STARTS = "Your plan's automatic starts are all in use: pause one to run this."
const NO_CREDITS =
  'Your organization ran out of credits, so this run was skipped. Add credits to run it.'
/** Codes and statuses that plain output must never show. */
const RAW = [
  'no_credits',
  'billing_unavailable',
  'NO_CREDITS',
  'SPEND_CAP_REACHED',
  'credit_check_unavailable',
  'no_free_automatic_start',
  'automatic_start_limit',
  'needs_capability',
  'limited',
  'private',
]

const agentRow = (overrides: Record<string, unknown> = {}) => ({
  id: `srun_${suffix}`,
  scheduledQueryId: id,
  status: 'skipped',
  agentRunId: null,
  agentRunStatus: null,
  chatId: null,
  taskId: null,
  taskStatus: null,
  scheduledFor: at,
  executedAt: at,
  ...overrides,
})
const started = {
  status: 'success',
  agentRunId: `agent_run_${suffix}`,
  agentRunStatus: 'completed',
  chatId: `chat_${suffix}`,
  taskId: `atask_${suffix}`,
  taskStatus: 'completed',
}

async function history(runs: unknown[], json: boolean) {
  let stdout = ''
  const exitCode = await main(['schedule', 'history', id, ...(json ? ['--json'] : [])], {
    env,
    writeOut: (text) => (stdout += text),
    writeErr: () => undefined,
    fetch: async () => Response.json({ runs }),
  })
  expect(exitCode).toBe(0)
  return stdout
}

async function fileRuns(runs: unknown[], json: boolean) {
  let stdout = ''
  const exitCode = await main(['schedule', 'file', 'runs', id, ...(json ? ['--json'] : [])], {
    env,
    writeOut: (text) => (stdout += text),
    writeErr: () => undefined,
    fetch: async () => Response.json({ runs }),
  })
  expect(exitCode).toBe(0)
  return stdout
}

/** A plain-output row's tab-separated column, or null when the row has none. */
function column(line: string, index: number): string | null {
  return line.split('\t')[index] ?? null
}

function expectNoCodes(text: string) {
  for (const raw of RAW) expect(text).not.toContain(raw)
  expect(text).not.toMatch(/\b[1-5]\d\d\b/)
}

describe('schedule run reasons', () => {
  it('words every reason the server names', () => {
    expect(Object.keys(SCHEDULE_RUN_REASON_TEXT).sort()).toEqual(
      [
        'credit_check_unavailable',
        'no_credits',
        'spend_limit_reached',
        'spend_needs_approval',
        'plan_inactive',
        'no_free_automatic_start',
        'needs_reapproval',
        'needs_run',
        'schedule_paused',
        'owner_paused',
        'owner_left',
        'agent_unavailable',
        'project_changed',
        'data_unavailable',
        'not_allowed_here',
        'held_by_admin',
        'model_provider_blocked',
        'busy',
        'code_flagged',
        'code_check_unavailable',
        'alert_loop',
        'chain_depth_limit',
        'alert_daily_limit',
        'table_daily_limit',
        'run_failed',
        'other',
      ].sort()
    )
    expect(SCHEDULE_RUN_REASON_TEXT.credit_check_unavailable).toBe(CREDIT_CHECK)
    expect(SCHEDULE_RUN_REASON_TEXT.no_free_automatic_start).toBe(AUTOMATIC_STARTS)
    for (const text of Object.values(SCHEDULE_RUN_REASON_TEXT)) expectNoCodes(text)
  })

  it('words the two reasons an older server recorded as sentences', () => {
    expect(scheduleRunReasonText('skipped', null, 'User is no longer a member of the org')).toBe(
      SCHEDULE_RUN_REASON_TEXT.owner_left
    )
    expect(scheduleRunReasonText('skipped', null, 'Agent no longer exists')).toBe(
      SCHEDULE_RUN_REASON_TEXT.agent_unavailable
    )
  })
})

describe('teler schedule history reasons', () => {
  const rows = [
    agentRow({ reason: 'credit_check_unavailable', errorMessage: 'billing_unavailable' }),
    agentRow({ reason: 'no_free_automatic_start', errorMessage: 'automatic_start_limit' }),
    agentRow({ reason: 'a_reason_added_later' }),
    agentRow({ status: 'failed', reason: 'a_reason_added_later' }),
    agentRow({ reason: 'HTTP 503 Service Unavailable' }),
    agentRow({ ...started, agentRunOutcome: 'limited', agentRunReason: 'needs_capability' }),
    agentRow({ ...started, agentRunOutcome: 'failed', agentRunReason: 'a_reason_added_later' }),
    agentRow({ ...started, agentRunStatus: 'cancelled', agentRunOutcome: 'cancelled' }),
    agentRow({ ...started, agentRunOutcome: 'an_outcome_added_later' }),
    agentRow({ ...started, agentRunOutcome: 'success', agentRunReason: null }),
  ]

  it('prints why a run was skipped or did not finish, in words only', async () => {
    const lines = (await history(rows, false)).trimEnd().split('\n')
    expect(lines.map((line) => column(line, 5))).toEqual([
      CREDIT_CHECK,
      AUTOMATIC_STARTS,
      'This run was skipped.',
      "The run didn't finish.",
      'This run was skipped.',
      "It started but didn't finish: it needed a capability its Agent doesn't have.",
      "It started but didn't finish.",
      "It started but didn't finish: it was cancelled.",
      null,
      null,
    ])
    expectNoCodes(lines.join('\n'))
  })

  it('keeps the codes in --json and adds the sentence; a value that is not a code reads as none', async () => {
    const { runs } = JSON.parse(await history(rows, true)) as {
      runs: Array<Record<string, unknown>>
    }
    expect(runs[0]).toMatchObject({
      reason: 'credit_check_unavailable',
      agentRunOutcome: null,
      agentRunReason: null,
      reasonText: CREDIT_CHECK,
    })
    expect(runs[0]).not.toHaveProperty('errorMessage')
    expect(runs[2]).toMatchObject({ reason: 'a_reason_added_later' })
    expect(runs[4]).toMatchObject({ reason: null, reasonText: 'This run was skipped.' })
    expect(runs[5]).toMatchObject({
      status: 'success',
      agentRunOutcome: 'limited',
      agentRunReason: 'needs_capability',
    })
    expect(runs[8]).toMatchObject({ agentRunOutcome: 'an_outcome_added_later', reasonText: null })
  })

  it('words an older server’s rows from what they recorded, without printing it', async () => {
    const old = [
      agentRow({ errorMessage: 'no_credits' }),
      agentRow({ errorMessage: 'automatic_start_limit' }),
      agentRow({ errorMessage: 'private-token https://private/db?password=x' }),
      agentRow({ ...started, agentRunStatus: 'failed' }),
      agentRow({ ...started, agentRunStatus: 'running' }),
    ]
    const plain = await history(old, false)
    expect(
      plain
        .trimEnd()
        .split('\n')
        .map((line) => column(line, 5))
    ).toEqual([
      NO_CREDITS,
      AUTOMATIC_STARTS,
      'This run was skipped.',
      "It started but didn't finish.",
      null,
    ])
    expectNoCodes(plain)

    const json = await history(old, true)
    const { runs } = JSON.parse(json) as { runs: Array<Record<string, unknown>> }
    expect(runs[0]).toMatchObject({
      reason: null,
      agentRunOutcome: null,
      agentRunReason: null,
      reasonText: NO_CREDITS,
    })
    expect(json).not.toContain('private')
    expect(json).not.toContain('errorMessage')
  })
})

describe('teler schedule file runs reasons', () => {
  const occurrence = (overrides: Record<string, unknown> = {}) => ({
    id: `srun_${suffix}`,
    status: 'skipped',
    scheduledFor: at,
    executedAt: at,
    errorMessage: null,
    savedCodeRunId: null,
    savedCodeRunStatus: null,
    attempts: 0,
    settledAt: null,
    ...overrides,
  })

  it('prefers the server’s reason, and words an older server’s codes', async () => {
    const runs = [
      // A newer server: its reason wins over the recorded code.
      occurrence({ errorMessage: 'billing_unavailable', reason: 'credit_check_unavailable' }),
      occurrence({ errorMessage: 'SOME_LATER_CODE', reason: 'a_reason_added_later' }),
      // An older server: only the code.
      occurrence({ errorMessage: 'NO_CREDITS' }),
      occurrence({ errorMessage: 'SPEND_CAP_REACHED' }),
      occurrence({ errorMessage: 'SOME_LATER_CODE' }),
      occurrence({ errorMessage: 'private-token https://private/db?password=x' }),
      occurrence({
        status: 'failed',
        errorMessage: 'CODE_FLAGGED',
        savedCodeRunId: `scrun_${suffix}`,
        savedCodeRunStatus: 'failed',
        settledAt: at,
      }),
      occurrence({
        status: 'failed',
        savedCodeRunId: `scrun_${suffix}`,
        savedCodeRunStatus: 'failed',
      }),
      occurrence({
        status: 'success',
        savedCodeRunId: `scrun_${suffix}`,
        savedCodeRunStatus: 'running',
      }),
    ]
    const plain = await fileRuns(runs, false)
    expect(
      plain
        .trimEnd()
        .split('\n')
        .map((line) => column(line, 3))
    ).toEqual([
      CREDIT_CHECK,
      'This run was skipped.',
      NO_CREDITS,
      'This schedule reached its spending limit, so this run was skipped.',
      'This run was skipped.',
      'This run was skipped.',
      "Teler's safety check refused this File's code, so this run was skipped.",
      "The run didn't finish.",
      'running',
    ])
    expectNoCodes(plain)
    expect(plain).not.toContain('SOME_LATER_CODE')
    expect(plain).not.toContain('CODE_FLAGGED')

    const json = JSON.parse(await fileRuns(runs, true)) as {
      runs: Array<{ reason: string | null; reasonText: string | null }>
    }
    expect(json.runs.map((run) => run.reason)).toEqual([
      'billing_unavailable',
      'SOME_LATER_CODE',
      'NO_CREDITS',
      'SPEND_CAP_REACHED',
      'SOME_LATER_CODE',
      null,
      'CODE_FLAGGED',
      null,
      null,
    ])
    expect(json.runs[0]?.reasonText).toBe(CREDIT_CHECK)
    expect(json.runs[8]?.reasonText).toBeNull()
  })
})
