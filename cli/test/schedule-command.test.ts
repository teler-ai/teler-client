import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const id = `sched_${suffix}`
const agentId = `agent_${suffix}`
const org = `org_${suffix}`
const now = '2026-10-02T12:00:00.000Z'
const env = { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'private-token' }
const schedule = {
  id,
  agentId,
  organizationId: org,
  frequency: 'daily',
  timeUtc: '12:01',
  dayOfWeek: null,
  dayOfMonth: null,
  deliveryMethod: 'chat',
  isPaused: false,
  lastRunAt: null,
  nextRunAt: now,
  lastRunStatus: null,
  createdAt: now,
  updatedAt: now,
}

describe('real Agent schedule controls', () => {
  it('passes explicit project placement on create and update without changing omitted placement', async () => {
    const projectId = `prj_${suffix}`
    const requests: unknown[] = []
    for (const argv of [
      [
        'schedule',
        'create',
        '--org',
        org,
        '--agent',
        agentId,
        '--frequency',
        'daily',
        '--time-utc',
        '12:01',
        '--project',
        projectId,
      ],
      ['schedule', 'update', id, '--project', projectId],
    ])
      expect(
        await main([...argv, '--json'], {
          env,
          writeOut: () => undefined,
          fetch: async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)))
            return Response.json({ ...schedule, projectId })
          },
        })
      ).toBe(0)
    expect(requests).toEqual([
      { organizationId: org, agentId, frequency: 'daily', timeUtc: '12:01', projectId },
      { projectId },
    ])
  })
  it('creates, lists, updates, pauses and deletes through normal authenticated routes', async () => {
    const requests: Array<{ path: string; method: string; body: unknown }> = []
    const fetch = async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      const method = init?.method ?? 'GET'
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined
      requests.push({ path: parsed.pathname + parsed.search, method, body })
      if (method === 'DELETE') return new Response(null, { status: 204 })
      if (method === 'GET') return Response.json({ schedules: [schedule] })
      return Response.json(schedule)
    }
    for (const argv of [
      [
        'schedule',
        'create',
        '--org',
        org,
        '--agent',
        agentId,
        '--frequency',
        'daily',
        '--time-utc',
        '12:01',
      ],
      ['schedule', 'list', '--org', org],
      [
        'schedule',
        'update',
        id,
        '--frequency',
        'weekly',
        '--day-of-week',
        '5',
        '--time-utc',
        '14:02',
      ],
      ['schedule', 'pause', id],
      ['schedule', 'delete', id, '--yes'],
    ])
      expect(await main([...argv, '--json'], { env, fetch, writeOut: () => undefined })).toBe(0)
    expect(requests).toEqual([
      {
        path: '/api/schedule',
        method: 'POST',
        body: { organizationId: org, agentId, frequency: 'daily', timeUtc: '12:01' },
      },
      { path: `/api/schedule?organizationId=${org}`, method: 'GET', body: undefined },
      {
        path: `/api/schedule/${id}`,
        method: 'PATCH',
        body: {
          frequency: 'weekly',
          dayOfWeek: 5,
          timeUtc: '14:02',
        },
      },
      { path: `/api/schedule/${id}`, method: 'PATCH', body: { isPaused: true } },
      { path: `/api/schedule/${id}`, method: 'DELETE', body: undefined },
    ])
  })

  it('exposes actual occurrence and linked Agent run/task lifecycle without untrusted error text', async () => {
    let output = ''
    const run = {
      id: `srun_${suffix}`,
      scheduledQueryId: id,
      status: 'success',
      agentRunId: `agent_run_${suffix}`,
      agentRunStatus: 'running',
      chatId: `chat_${suffix}`,
      taskId: `atask_${suffix}`,
      taskStatus: 'running',
      scheduledFor: now,
      executedAt: now,
      errorMessage: 'private-token https://private/db?password=private-value',
    }
    expect(
      await main(['schedule', 'history', id, '--json'], {
        env,
        writeOut: (text) => {
          output += text
        },
        fetch: async (url) => {
          expect(new URL(url).pathname).toBe(`/api/schedule/${id}/history`)
          return Response.json({ runs: [run] })
        },
      })
    ).toBe(0)
    const { errorMessage: _errorMessage, ...metadata } = run
    expect(JSON.parse(output)).toEqual({ runs: [metadata] })
    expect(output).not.toContain('private-token')
    expect(output).not.toContain('private-value')
  })

  it('rejects accelerated cadence, invalid dates and unsupported updates before network calls', async () => {
    let calls = 0
    for (const argv of [
      [
        'schedule',
        'create',
        '--org',
        org,
        '--agent',
        agentId,
        '--frequency',
        'minute',
        '--time-utc',
        '12:01',
      ],
      [
        'schedule',
        'create',
        '--org',
        org,
        '--agent',
        agentId,
        '--frequency',
        'weekly',
        '--time-utc',
        '12:01',
      ],
      [
        'schedule',
        'create',
        '--org',
        org,
        '--agent',
        agentId,
        '--frequency',
        'daily',
        '--time-utc',
        '24:01',
      ],
      ['schedule', 'update', id],
      ['schedule', 'update', id, '--next-run-at', now],
      ['schedule', 'update', id, '--project', 'project_wrong'],
      ['schedule', 'delete', id],
    ])
      expect(
        await main(argv, {
          env,
          writeErr: () => undefined,
          fetch: async () => {
            calls += 1
            return Response.json({})
          },
        })
      ).toBe(2)
    expect(calls).toBe(0)
  })

  it('preserves Agent readiness refusal codes without exposing response content', async () => {
    let stderr = ''
    expect(
      await main(
        [
          'schedule',
          'create',
          '--org',
          org,
          '--agent',
          agentId,
          '--frequency',
          'daily',
          '--time-utc',
          '12:01',
        ],
        {
          env,
          writeErr: (text) => {
            stderr += text
          },
          fetch: async () =>
            Response.json(
              {
                code: 'ACCESS_DENIED',
                error: 'private-token member@example.com?secret=private-value',
              },
              { status: 403 }
            ),
        }
      )
    ).toBe(1)
    expect(stderr).toContain('403 ACCESS_DENIED')
    for (const secret of ['private-token', 'private-value', 'member@example.com'])
      expect(stderr).not.toContain(secret)
  })

  it('names the capabilities to approve and sends approvals on create and approve', async () => {
    const createArgs = [
      'schedule',
      'create',
      '--org',
      org,
      '--agent',
      agentId,
      '--frequency',
      'daily',
      '--time-utc',
      '12:01',
    ]
    let stderr = ''
    expect(
      await main(createArgs, {
        env,
        writeErr: (text) => {
          stderr += text
        },
        fetch: async () =>
          Response.json(
            {
              code: 'SCHEDULE_APPROVAL_REQUIRED',
              error: 'secret body text',
              capabilities: ['web.search', 'tables.rows.read', 'not a capability'],
            },
            { status: 409 }
          ),
      })
    ).toBe(1)
    // A malformed list is dropped whole rather than echoed.
    expect(stderr).toContain('409 SCHEDULE_APPROVAL_REQUIRED')
    expect(stderr).not.toContain('secret body text')

    stderr = ''
    await main(createArgs, {
      env,
      writeErr: (text) => {
        stderr += text
      },
      fetch: async () =>
        Response.json(
          { code: 'SCHEDULE_APPROVAL_REQUIRED', capabilities: ['web.search', 'tables.rows.read'] },
          { status: 409 }
        ),
    })
    expect(stderr).toContain('--approve web.search,tables.rows.read')

    const bodies: unknown[] = []
    const fetch = async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json(schedule)
    }
    expect(
      await main([...createArgs, '--approve', 'web.search,tables.rows.read'], { env, fetch })
    ).toBe(0)
    expect(await main(['schedule', 'approve', id, '--approve', 'web.search'], { env, fetch })).toBe(
      0
    )
    expect(bodies).toEqual([
      expect.objectContaining({ approvedCapabilities: ['web.search', 'tables.rows.read'] }),
      { approvedCapabilities: ['web.search'] },
    ])
  })
})

describe('event starts in the schedule commands', () => {
  const eventId = `sched_${'02m2k72d22fqe8ww472ycs3px3'}`
  const upstreamId = `agent_${'03m2k72d22fqe8ww472ycs3px3'}`
  const tableStart = {
    id: eventId,
    startKind: 'table_update',
    agentId,
    organizationId: org,
    startTable: { kind: 'connector', id: 'ctbl_x', label: 'Sales' },
    startAgent: null,
    deliveryMethod: 'chat',
    isPaused: false,
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: now,
    updatedAt: now,
    // Fields the CLI does not show.
    prompt: 'private prompt text',
    membershipId: 'member_private',
  }
  const agentStart = {
    ...tableStart,
    id: `sched_${'04m2k72d22fqe8ww472ycs3px3'}`,
    startKind: 'agent_finished',
    startTable: null,
    startAgent: { id: upstreamId, label: 'Stock alerts' },
  }

  it('lists them beside the time schedules, in words and as JSON', async () => {
    let human = ''
    const fetch = async () =>
      Response.json({ schedules: [schedule], eventStarts: [tableStart, agentStart] })
    expect(
      await main(['schedule', 'list', '--org', org], {
        env,
        fetch,
        writeOut: (text) => {
          human += text
        },
      })
    ).toBe(0)
    expect(human).toContain(`${eventId}\ttable_update\tstarts when its table updates`)
    expect(human).toContain('agent_finished\tstarts when another Agent finishes')
    expect(human).toContain(`${id}\tdaily\t${now}`)

    let json = ''
    expect(
      await main(['schedule', 'list', '--org', org, '--json'], {
        env,
        fetch,
        writeOut: (text) => {
          json += text
        },
      })
    ).toBe(0)
    const parsed = JSON.parse(json) as { eventStarts: Array<Record<string, unknown>> }
    expect(parsed.eventStarts.map((start) => start.startKind)).toEqual([
      'table_update',
      'agent_finished',
    ])
    expect(json).not.toContain('private prompt text')
    expect(json).not.toContain('member_private')
  })

  it('lists an older server’s time schedules without event starts', async () => {
    let human = ''
    expect(
      await main(['schedule', 'list', '--org', org], {
        env,
        fetch: async () => Response.json({ schedules: [schedule] }),
        writeOut: (text) => {
          human += text
        },
      })
    ).toBe(0)
    expect(human).toBe(`${id}\tdaily\t${now}\n`)
  })

  it('pauses and resumes an event start, which has no next run to print', async () => {
    const outputs: string[] = []
    for (const [action, paused] of [
      ['pause', true],
      ['resume', false],
    ] as const) {
      let text = ''
      expect(
        await main(['schedule', action, eventId], {
          env,
          fetch: async () => Response.json({ ...tableStart, isPaused: paused }),
          writeOut: (chunk) => {
            text += chunk
          },
        })
      ).toBe(0)
      outputs.push(text)
    }
    expect(outputs).toEqual([
      `Updated ${eventId}: paused\n`,
      `Updated ${eventId}: starts when its table updates\n`,
    ])
  })

  it('approves an event start', async () => {
    let text = ''
    expect(
      await main(['schedule', 'approve', eventId], {
        env,
        fetch: async () => Response.json(agentStart),
        writeOut: (chunk) => {
          text += chunk
        },
      })
    ).toBe(0)
    expect(text).toBe(`Approved ${agentStart.id}: starts when another Agent finishes\n`)
  })
})
