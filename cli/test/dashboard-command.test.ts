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
        refreshInterval: '5m',
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
        '5m',
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
      ['dashboard', 'update', dashboardId, '--refresh-interval', '5m'],
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
          refreshInterval: '5m',
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
      { path: `/api/dashboard/${dashboardId}`, method: 'PATCH', body: { refreshInterval: '5m' } },
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
      refreshInterval: '5m',
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
      expect(output).toContain('"refreshInterval":"5m"')
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

  it('redacts normal API refusal bodies and query values', async () => {
    let stderr = ''
    expect(
      await main(['dashboard', 'update', dashboardId, '--refresh-interval', '5m'], {
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
