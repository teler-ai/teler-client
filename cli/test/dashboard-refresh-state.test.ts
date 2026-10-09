import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'
import type { CredentialStore } from '../src/credentials'

const dashboardId = 'dash_01m2mgs69ge8nvmkdg6924cgg9'
const organizationId = 'org_01m2mgs69ge8nvmkdg6924cgg9'
const successAt = '2026-10-02T10:00:00.000Z'
const attemptAt = '2026-10-02T12:00:00.000Z'
const store: CredentialStore = {
  get: async () => 'synthetic-token',
  set: async () => undefined,
  delete: async () => undefined,
}

async function readWidget(refreshState?: Record<string, unknown>) {
  let output = ''
  let error = ''
  const exitCode = await main(
    ['dashboard', 'get', dashboardId, '--org', organizationId, '--json'],
    {
      store,
      writeOut: (text) => (output += text),
      writeErr: (text) => (error += text),
      fetch: async () =>
        Response.json({
          dashboardId,
          name: 'Automatic overview',
          description: null,
          refreshInterval: '5m',
          lastRefreshedAt: attemptAt,
          createdAt: successAt,
          updatedAt: attemptAt,
          widgets: [
            {
              widgetId: 'dwgt_01m2mgs69ge8nvmkdg6924cgg9',
              artifactId: 'artifact_01m2mgs69ge8nvmkdg6924cgg9',
              artifactSlug: 'overview',
              artifactType: 'line',
              title: null,
              description: null,
              position: { x: 0, y: 0, w: 4, h: 3 },
              sortOrder: 0,
              ...(refreshState ? { refreshState } : {}),
            },
          ],
        }),
    }
  )
  return { exitCode, output, error }
}

describe('dashboard refresh-state JSON', () => {
  it('keeps a failed attempt and older success distinct, stripping raw fields', async () => {
    const result = await readWidget({
      status: 'error',
      lastAttemptAt: attemptAt,
      lastSuccessAt: successAt,
      errorReason: 'execution_failed',
      error: 'Bearer secret https://private.invalid/?token=secret',
      metadata: { prompt: 'private prompt' },
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.output).widgets[0].refreshState).toEqual({
      status: 'error',
      lastAttemptAt: attemptAt,
      lastSuccessAt: successAt,
      errorReason: 'execution_failed',
      pausedReason: null,
    })
    expect(result.output).not.toMatch(/private|secret|metadata|prompt/)
  })

  it('accepts ready state and missing legacy observation fields', async () => {
    const ready = await readWidget({
      status: 'ready',
      lastAttemptAt: successAt,
      lastSuccessAt: successAt,
      errorReason: null,
    })
    expect(JSON.parse(ready.output).widgets[0].refreshState.status).toBe('ready')
    const legacy = await readWidget()
    expect(legacy.exitCode).toBe(0)
    expect(JSON.parse(legacy.output).widgets[0].refreshState).toEqual({
      status: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      errorReason: null,
      pausedReason: null,
    })
  })

  it('reads a refresh paused for credits from pausedReason', async () => {
    const result = await readWidget({
      status: 'error',
      lastAttemptAt: attemptAt,
      lastSuccessAt: successAt,
      errorReason: null,
      pausedReason: 'no_credits',
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.output).widgets[0].refreshState).toMatchObject({
      errorReason: null,
      pausedReason: 'no_credits',
    })
  })

  it('rejects non-static failure categories without echoing their values', async () => {
    const result = await readWidget({
      status: 'error',
      lastAttemptAt: attemptAt,
      lastSuccessAt: null,
      errorReason: 'Bearer secret https://private.invalid/?token=secret',
    })
    expect(result.exitCode).toBe(1)
    expect(result.output).toBe('')
    expect(result.error).not.toMatch(/private|secret|Bearer/)
  })
})
