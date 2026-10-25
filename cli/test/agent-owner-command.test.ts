import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const agentId = `agent_${suffix}`
const runId = `agent_run_${suffix}`
const newRunId = `agent_run_${'02m2k72d22fqe8ww472ycs3px3'}`
const chatId = `chat_${suffix}`
const projectId = `prj_${suffix}`
const env = { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'private-token' }

interface Sent {
  method: string
  path: string
  body: unknown
  idempotencyKey: string | null
}

function server(answer: (sent: Sent) => Response) {
  const sent: Sent[] = []
  const fetch = async (url: string, init?: RequestInit) => {
    const request: Sent = {
      method: init?.method ?? 'GET',
      path: new URL(url).pathname,
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      idempotencyKey: new Headers(init?.headers).get('Idempotency-Key'),
    }
    sent.push(request)
    return answer(request)
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

describe('teler agent run', () => {
  const started = () =>
    Response.json({ runId: newRunId, chatId, agentTaskId: `atask_${suffix}` }, { status: 201 })

  it('runs an Agent now with a prompt, a project, approvals and the caller’s key', async () => {
    const api = server(started)
    const result = await cli(
      [
        'agent',
        'run',
        agentId,
        '--prompt',
        'Check last week only',
        '--project',
        projectId,
        '--approve',
        'tables.rows.write',
        '--idempotency-key',
        'weekly-check-0001',
        '--json',
      ],
      api.fetch
    )
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      runId: newRunId,
      chatId,
      agentTaskId: `atask_${suffix}`,
    })
    expect(api.sent).toEqual([
      {
        method: 'POST',
        path: `/api/agent/${agentId}/run`,
        body: {
          prompt: 'Check last week only',
          projectId,
          approvedCapabilities: ['tables.rows.write'],
        },
        idempotencyKey: 'weekly-check-0001',
      },
    ])
  })

  it('says how to follow the run', async () => {
    const api = server(started)
    const result = await cli(
      ['agent', 'run', agentId, '--idempotency-key', 'weekly-check-0002'],
      api.fetch
    )
    expect(result.stdout).toBe(
      `Started ${newRunId}. Follow it: teler agent runs --agent ${agentId} --active\n`
    )
    expect(api.sent[0]?.body).toEqual({})
  })

  it('needs a key, so a retry after a lost answer starts nothing new', async () => {
    const api = server(started)
    const result = await cli(['agent', 'run', agentId], api.fetch)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--idempotency-key')
    expect(api.sent).toEqual([])
  })

  it('names what to approve when the Agent needs it', async () => {
    const api = server(() =>
      Response.json(
        {
          error: 'Approve',
          code: 'AGENT_CAPABILITY_APPROVAL_REQUIRED',
          capabilities: ['tables.rows.write'],
        },
        { status: 409 }
      )
    )
    const result = await cli(
      ['agent', 'run', agentId, '--idempotency-key', 'weekly-check-0003'],
      api.fetch
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('tables.rows.write')
    expect(result.stderr).toContain('--approve tables.rows.write')
  })

  it('refuses a bad Agent ID or an empty prompt before any request', async () => {
    const api = server(started)
    for (const argv of [
      ['agent', 'run', 'agent_nope', '--idempotency-key', 'weekly-check-0004'],
      ['agent', 'run', agentId, '--prompt', '', '--idempotency-key', 'weekly-check-0004'],
      ['agent', 'run', agentId, '--idempotency-key', 'short'],
      ['agent', 'run'],
    ])
      expect((await cli(argv, api.fetch)).exitCode).toBe(2)
    expect(api.sent).toEqual([])
  })
})

describe('teler agent spend-cap', () => {
  it('reads the cap and what it approved this month', async () => {
    const api = server(() =>
      Response.json({ agentId, spendCapCreditsPerMonth: 40, approvedThisMonthCredits: '12.5' })
    )
    const read = await cli(['agent', 'spend-cap', agentId], api.fetch)
    expect(read.stdout).toBe(
      `${agentId} may approve up to 40 credits a month of File schedule spend for you; 12.5 approved this month\n`
    )
    const none = server(() =>
      Response.json({ agentId, spendCapCreditsPerMonth: null, approvedThisMonthCredits: '0' })
    )
    expect((await cli(['agent', 'spend-cap', agentId], none.fetch)).stdout).toBe(
      `${agentId} approves no File schedule spend for you; 0 approved this month\n`
    )
  })

  it('sets a monthly cap, or none', async () => {
    const api = server((sent) =>
      Response.json({
        agentId,
        spendCapCreditsPerMonth: (sent.body as { creditsPerMonth: number | null }).creditsPerMonth,
      })
    )
    const set = await cli(
      ['agent', 'spend-cap', agentId, '--monthly-credits', '40', '--yes'],
      api.fetch
    )
    expect(set.stdout).toBe(
      `${agentId} may approve up to 40 credits a month of File schedule spend for you\n`
    )
    const cleared = await cli(['agent', 'spend-cap', agentId, '--none', '--json'], api.fetch)
    expect(JSON.parse(cleared.stdout)).toEqual({ agentId, spendCapCreditsPerMonth: null })
    expect(api.sent.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: 'PUT', path: `/api/agent/${agentId}/spend-cap`, body: { creditsPerMonth: 40 } },
      { method: 'PUT', path: `/api/agent/${agentId}/spend-cap`, body: { creditsPerMonth: null } },
    ])
  })

  it('refuses a cap that is not a whole number from 1 to 1000000, both flags, or no --yes', async () => {
    const api = server(() => Response.json({}))
    for (const flags of [
      ['--monthly-credits', '0', '--yes'],
      ['--monthly-credits', '2.5', '--yes'],
      ['--monthly-credits', '1000001', '--yes'],
      ['--monthly-credits', '5', '--none', '--yes'],
      ['--monthly-credits', '5'],
    ])
      expect((await cli(['agent', 'spend-cap', agentId, ...flags], api.fetch)).exitCode).toBe(2)
    expect(api.sent).toEqual([])
  })
})

describe('a run’s skipped actions', () => {
  it('allows what a scheduled run skipped and runs it again', async () => {
    const api = server(() =>
      Response.json({ runId: newRunId, allowed: ['tables.rows.write'] }, { status: 201 })
    )
    const result = await cli(
      ['agent', 'allow-and-rerun', runId, '--capabilities', 'tables.rows.write'],
      api.fetch
    )
    expect(result.stdout).toBe(
      `Allowed tables.rows.write for this schedule's runs; started ${newRunId}\n`
    )
    expect(api.sent.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      {
        method: 'POST',
        path: `/api/agent-run/${runId}/allow-and-rerun`,
        body: { capabilities: ['tables.rows.write'] },
      },
    ])
  })

  it('says when it allowed them but could not start the run now', async () => {
    const api = server(() =>
      Response.json(
        { runId: null, allowed: ['tables.rows.write'], reason: 'no_credits' },
        { status: 202 }
      )
    )
    const result = await cli(['agent', 'allow-and-rerun', runId], api.fetch)
    expect(result.stdout).toBe(
      "Allowed tables.rows.write for this schedule's runs; the run did not start now (no_credits)\n"
    )
    expect(api.sent[0]?.body).toEqual({})
  })

  it('applies the alert recipients a run kept for you, by their place in its list', async () => {
    const api = server(() =>
      Response.json({
        status: 'applied',
        label: 'Stock alerts',
        emailOwner: true,
        colleagueNames: ['Pat Example', 'Lee Example'],
      })
    )
    const result = await cli(['agent', 'apply-skipped', runId, '2'], api.fetch)
    expect(result.stdout).toBe(
      'Applied: alerts of Stock alerts reach you, by email too, and Pat Example, Lee Example\n'
    )
    expect(api.sent[0]).toMatchObject({
      method: 'POST',
      path: `/api/agent-run/${runId}/skipped-actions/2/apply`,
    })
  })

  it('refuses a bad run ID or position before any request', async () => {
    const api = server(() => Response.json({}))
    for (const argv of [
      ['agent', 'allow-and-rerun', agentId],
      ['agent', 'apply-skipped', runId, '20'],
      ['agent', 'apply-skipped', runId, '-1'],
      ['agent', 'apply-skipped', runId],
    ])
      expect((await cli(argv, api.fetch)).exitCode).toBe(2)
    expect(api.sent).toEqual([])
  })
})
