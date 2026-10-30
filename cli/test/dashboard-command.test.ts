import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const dashboardId = `dash_${suffix}`
const artifactId = `artifact_${suffix}`
const widgetId = `dwgt_${suffix}`
const organizationId = `org_${suffix}`
const env = { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'private-token' }
const refreshed = '2026-10-02T12:00:00.000Z'

describe('dashboard controls', () => {
  it('creates, pins artifacts, updates intervals and archives through the normal API', async () => {
    const requests: Array<{ path: string; method: string; body: unknown }> = []
    const fetch = async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname
      const method = init?.method ?? 'GET'
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined
      requests.push({ path, method, body })
      if (method === 'DELETE') return new Response(null, { status: 204 })
      if (path.endsWith('/widget'))
        return Response.json({
          id: widgetId,
          dashboardId,
          artifactId,
          position: { x: 0, y: 0, w: 4, h: 3 },
          sortOrder: 0,
          artifact: { config: { sql: 'private-query' }, storageKey: 'private-object' },
        })
      return Response.json({
        id: dashboardId,
        name: 'Capacity',
        description: null,
        refreshInterval: '15m',
        lastRefreshedAt: null,
        widgets: [],
        layout: { private: 'private-layout' },
      })
    }
    let output = ''
    for (const argv of [
      [
        'dashboard',
        'create',
        '--org',
        organizationId,
        '--name',
        'Capacity',
        '--refresh-interval',
        '15m',
      ],
      [
        'dashboard',
        'add-widget',
        dashboardId,
        '--artifact',
        artifactId,
        '--position',
        '{"x":0,"y":0,"w":4,"h":3}',
        '--idempotency-key',
        'capacity.widget.1',
      ],
      ['dashboard', 'update', dashboardId, '--refresh-interval', '15m'],
      ['dashboard', 'archive', dashboardId, '--yes'],
    ])
      expect(
        await main([...argv, '--json'], {
          env,
          fetch,
          writeOut: (text) => {
            output += text
          },
        })
      ).toBe(0)
    expect(requests).toEqual([
      {
        path: '/api/dashboard',
        method: 'POST',
        body: {
          organizationId,
          name: 'Capacity',
          refreshInterval: '15m',
          visibility: 'private',
        },
      },
      {
        path: `/api/dashboard/${dashboardId}/widget`,
        method: 'POST',
        body: {
          artifactId,
          position: { x: 0, y: 0, w: 4, h: 3 },
          idempotencyKey: 'capacity.widget.1',
        },
      },
      { path: `/api/dashboard/${dashboardId}`, method: 'PATCH', body: { refreshInterval: '15m' } },
      { path: `/api/dashboard/${dashboardId}`, method: 'DELETE', body: undefined },
    ])
    expect(output).toContain(dashboardId)
    for (const secret of ['private-token', 'private-query', 'private-object', 'private-layout']) {
      expect(output).not.toContain(secret)
    }
  })

  it('preserves refresh-state evidence from bounded list/get responses', async () => {
    const dashboard = {
      dashboardId,
      name: 'Capacity',
      description: null,
      refreshInterval: '15m',
      lastRefreshedAt: refreshed,
      createdAt: refreshed,
      updatedAt: refreshed,
    }
    for (const argv of [
      ['dashboard', 'list', '--org', organizationId, '--limit', '5'],
      ['dashboard', 'get', dashboardId, '--org', organizationId],
    ]) {
      let output = ''
      expect(
        await main([...argv, '--json'], {
          env,
          writeOut: (text) => {
            output += text
          },
          fetch: async (url) =>
            Response.json(
              new URL(url).pathname.endsWith(dashboardId)
                ? { ...dashboard, widgets: [] }
                : { dashboards: [dashboard], limit: 5, offset: 0 }
            ),
        })
      ).toBe(0)
      expect(output).toContain('"refreshInterval":"15m"')
      expect(output).toContain(`"lastRefreshedAt":"${refreshed}"`)
    }
  })

  it('rejects unsupported intervals, malformed positions and unconfirmed archives before network calls', async () => {
    let calls = 0
    for (const argv of [
      [
        'dashboard',
        'create',
        '--org',
        organizationId,
        '--name',
        'Capacity',
        '--refresh-interval',
        '5s',
      ],
      ['dashboard', 'update', dashboardId],
      ['dashboard', 'archive', dashboardId],
      [
        'dashboard',
        'add-widget',
        dashboardId,
        '--artifact',
        artifactId,
        '--position',
        '{"x":3,"y":0,"w":4,"h":3}',
      ],
      [
        'dashboard',
        'add-widget',
        dashboardId,
        '--artifact',
        'invalid',
        '--position',
        '{"x":0,"y":0,"w":4,"h":3}',
      ],
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

  it('adds a widget that follows a schedule with the binding its output is drawn with', async () => {
    const scheduleId = `sched_${suffix}`
    const requests: Array<{ path: string; method: string; body: unknown }> = []
    let output = ''
    const fetch = async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname
      const method = init?.method ?? 'GET'
      requests.push({
        path,
        method,
        body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      })
      return Response.json({ widgetId, dashboardId }, { status: 201 })
    }
    expect(
      await main(
        [
          'dashboard',
          'add-widget',
          dashboardId,
          '--schedule',
          scheduleId,
          '--slot',
          'result',
          '--chart',
          'line',
          '--x',
          'date',
          '--y',
          'yhat',
          '--color',
          'category',
          '--org',
          organizationId,
          '--json',
        ],
        { env, fetch, writeOut: (text) => (output += text) }
      )
    ).toBe(0)
    expect(requests).toEqual([
      {
        path: '/api/dashboard-follows',
        method: 'POST',
        body: {
          organizationId,
          scheduleId,
          dashboardId,
          binding: {
            schemaVersion: 1,
            slot: 'result',
            renderer: 'chart',
            config: { type: 'line', encoding: { x: 'date', y: 'yhat', color: 'category' } },
          },
          title: 'result',
        },
      },
    ])
    expect(JSON.parse(output)).toEqual({ widgetId, dashboardId })
    // A field a chart lacks or can't use is refused, by name, before any request.
    for (const [extra, message] of [
      [['--chart', 'bar', '--x', 'date'], 'A bar chart needs --x and --y'],
      [
        ['--chart', 'pie', '--x', 'category', '--y', 'yhat', '--color', 'date'],
        'Only a line, bar or scatter chart takes --color',
      ],
      [['--chart', 'table', '--x', 'date'], 'A table takes no --x, --y or --color'],
      [['--chart', 'number', '--x', 'date'], 'A number takes only --y'],
    ] as const) {
      let stderr = ''
      expect(
        await main(
          [
            'dashboard',
            'add-widget',
            dashboardId,
            '--schedule',
            scheduleId,
            '--slot',
            'result',
            '--org',
            organizationId,
            ...extra,
          ],
          { env, fetch, writeErr: (text) => (stderr += text) }
        )
      ).toBe(2)
      expect(stderr).toContain(message)
    }
    expect(requests).toHaveLength(1)
  })

  it('sends an idempotency key with a followed widget, so a retry returns the same widget', async () => {
    const scheduleId = `sched_${suffix}`
    const bodies: unknown[] = []
    const fetch = async (_url: string, init?: RequestInit) => {
      bodies.push(init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined)
      return Response.json({ widgetId, dashboardId }, { status: 201 })
    }
    const argv = [
      'dashboard',
      'add-widget',
      dashboardId,
      '--schedule',
      scheduleId,
      '--slot',
      'result',
      '--chart',
      'number',
      '--y',
      'yhat',
      '--org',
      organizationId,
      '--idempotency-key',
      'weekly-forecast-1',
    ]
    expect(await main(argv, { env, fetch, writeOut: () => {} })).toBe(0)
    expect(await main(argv, { env, fetch, writeOut: () => {} })).toBe(0)
    expect(bodies).toHaveLength(2)
    for (const body of bodies)
      expect(body).toMatchObject({ scheduleId, idempotencyKey: 'weekly-forecast-1' })
    // A key longer than the server accepts is refused before any request.
    let stderr = ''
    expect(
      await main([...argv.slice(0, -1), 'k'.repeat(129)], {
        env,
        fetch,
        writeErr: (text) => (stderr += text),
      })
    ).toBe(2)
    expect(bodies).toHaveLength(2)
  })

  it('shows whether each widget follows a schedule, and the File only to its owner', async () => {
    const updatedAt = '2026-10-29T22:45:23.000Z'
    const widget = (id: string, follow?: unknown) => ({
      id,
      dashboardId,
      artifactId,
      position: { x: 0, y: 0, w: 2, h: 4 },
      sortOrder: 0,
      ...(follow ? { follow } : {}),
    })
    const board = {
      id: dashboardId,
      name: 'Forecasts',
      description: null,
      widgets: [
        widget(`dwgt_${'1'.repeat(26)}`, {
          state: 'paused',
          updatedAt,
          owner: {
            fileId: `doc_${suffix}`,
            fileName: 'forecast.py',
            scheduleId: `sched_${suffix}`,
            resumesOn: '2026-11-01',
            failedRunAt: null,
          },
        }),
        widget(`dwgt_${'2'.repeat(26)}`, { state: 'stopped', reason: 'file_deleted', updatedAt }),
        widget(`dwgt_${'3'.repeat(26)}`),
      ],
    }
    let output = ''
    expect(
      await main(['dashboard', 'get', dashboardId, '--org', organizationId, '--json'], {
        env,
        fetch: async () => Response.json(board),
        writeOut: (text) => (output += text),
      })
    ).toBe(0)
    const read = JSON.parse(output) as { widgets: Array<{ follow?: unknown }> }
    expect(read.widgets.map((item) => item.follow)).toEqual([
      board.widgets[0]!.follow,
      { state: 'stopped', reason: 'file_deleted', updatedAt },
      undefined,
    ])
  })

  it('redacts normal API refusal bodies and query values', async () => {
    let stderr = ''
    expect(
      await main(['dashboard', 'update', dashboardId, '--refresh-interval', '15m'], {
        env,
        writeErr: (text) => {
          stderr += text
        },
        fetch: async () =>
          Response.json(
            {
              code: 'PLAN_LIMIT_REACHED',
              error: 'private-token https://private/db?secret=private-value member@example.com',
            },
            { status: 403 }
          ),
      })
    ).toBe(1)
    expect(stderr).toContain('403 PLAN_LIMIT_REACHED')
    for (const secret of ['private-token', 'private-value', 'member@example.com']) {
      expect(stderr).not.toContain(secret)
    }
  })

  it('approves a blocked refresh and names the asks it left out', async () => {
    const requests: Array<{ path: string; body: unknown }> = []
    let output = ''
    const fetch = async (url: string, init?: RequestInit) => {
      requests.push({ path: new URL(url).pathname, body: JSON.parse(String(init?.body)) })
      return Response.json({
        dashboardId,
        approvedCapabilities: ['tables.rows.read', 'web.fetch'],
        notApproved: ['web.search'],
        approvedAt: refreshed,
      })
    }
    const writeOut = (text: string) => {
      output += text
    }
    expect(
      await main(['dashboard', 'approve-refresh', dashboardId, '--approve', 'web.fetch'], {
        env,
        writeOut,
        fetch,
      })
    ).toBe(0)
    expect(requests).toEqual([
      {
        path: `/api/dashboard/${dashboardId}/approve-refresh`,
        body: { approvedCapabilities: ['web.fetch'] },
      },
    ])
    expect(output).toContain(`Approved refreshes of ${dashboardId}`)
    expect(output).toContain('--approve web.search')
  })
})
