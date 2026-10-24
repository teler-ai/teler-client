import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'
import { CLI_SCHEMA_REGISTRY } from '../src/schema-command'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const dashboardId = `dash_${suffix}`
const organizationId = `org_${suffix}`
const env = { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'private-token' }
const SETTINGS = ['manual', 'on_change', '15m', '30m', '1h', '4h', '5h', '1d']

const dashboard = (refreshInterval: string) => ({
  id: dashboardId,
  name: 'Capacity',
  description: null,
  refreshInterval,
  lastRefreshedAt: null,
})

async function run(argv: string[], respond: (body: unknown) => Response) {
  const bodies: unknown[] = []
  let stdout = ''
  let stderr = ''
  const exitCode = await main(argv, {
    env,
    fetch: async (_url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined
      bodies.push(body)
      return respond(body)
    },
    writeOut: (text) => void (stdout += text),
    writeErr: (text) => void (stderr += text),
  })
  return { exitCode, bodies, stdout, stderr }
}

const echo = (body: unknown) =>
  Response.json(dashboard((body as { refreshInterval?: string }).refreshInterval ?? 'manual'))

describe('dashboard refresh settings', () => {
  it('sends every setting the server accepts, unchanged', async () => {
    for (const setting of SETTINGS) {
      for (const argv of [
        ['dashboard', 'create', '--org', organizationId, '--name', 'Capacity'],
        ['dashboard', 'update', dashboardId],
      ]) {
        const result = await run([...argv, '--refresh-interval', setting, '--json'], echo)
        expect(result.exitCode).toBe(0)
        expect(result.bodies[0]).toMatchObject({ refreshInterval: setting })
        expect(JSON.parse(result.stdout)).toMatchObject({ refreshInterval: setting })
      }
    }
  })

  it('refuses intervals the server no longer offers before any request, naming the choices', async () => {
    for (const setting of ['1m', '5m', '6h', '5s']) {
      for (const argv of [
        ['dashboard', 'create', '--org', organizationId, '--name', 'Capacity'],
        ['dashboard', 'update', dashboardId],
      ]) {
        const result = await run([...argv, '--refresh-interval', setting], echo)
        expect(result.exitCode).toBe(2)
        expect(result.bodies).toEqual([])
        expect(result.stderr).toContain('manual|on_change|15m|30m|1h|4h|5h|1d')
      }
    }
  })

  it('reads the setting a dashboard already has, including the default and older values', async () => {
    for (const stored of ['manual', 'on_change', '5m', '6h']) {
      const result = await run(
        ['dashboard', 'create', '--org', organizationId, '--name', 'Capacity', '--json'],
        () => Response.json(dashboard(stored))
      )
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ dashboardId, refreshInterval: stored })
    }
  })

  it('says in words when an updated dashboard refreshes', async () => {
    for (const [setting, words] of [
      ['manual', 'refreshes only when asked'],
      ['on_change', 'refreshes when its data changes'],
      ['5h', 'refreshes every 5h'],
    ]) {
      const result = await run(
        ['dashboard', 'update', dashboardId, '--refresh-interval', String(setting)],
        echo
      )
      expect(result.stdout).toBe(`Updated ${dashboardId}: ${words}\n`)
    }
  })

  it('describes the settings in `teler schema`, leaving plan rules to the server', () => {
    for (const name of ['dashboard.create', 'dashboard.update']) {
      const entry = CLI_SCHEMA_REGISTRY.find((candidate) => candidate.name === name)
      expect(entry?.flags).toMatchObject({ refreshInterval: '--refresh-interval' })
      const schema = entry?.inputSchema as {
        properties: Record<string, { enum?: string[] }>
      }
      expect(schema.properties.refreshInterval?.enum).toEqual(SETTINGS)
      expect(JSON.stringify(entry)).not.toMatch(/plan/i)
    }
  })
})

describe('a refusal the server explains', () => {
  const PLAN_HINT = 'Pick a slower setting, such as 1d or manual.'
  const refuse = (body: object) => () =>
    Response.json({ error: 'Refused.', code: 'PLAN_LIMIT_EXCEEDED', ...body }, { status: 403 })
  const update = ['dashboard', 'update', dashboardId, '--refresh-interval', '15m']

  it("prints the server's hint in plain output and passes it through in --json", async () => {
    const plain = await run(update, refuse({ hint: PLAN_HINT }))
    expect(plain.exitCode).toBe(1)
    expect(plain.stderr).toBe(
      `teler: Teler API request failed (403 PLAN_LIMIT_EXCEEDED)\nhint: ${PLAN_HINT}\n`
    )
    const json = await run([...update, '--json'], refuse({ hint: PLAN_HINT }))
    expect(JSON.parse(json.stderr)).toEqual({
      error: {
        code: 'PLAN_LIMIT_EXCEEDED',
        message: 'Teler API request failed (403 PLAN_LIMIT_EXCEEDED)',
        status: 403,
        retryable: false,
        hint: PLAN_HINT,
      },
    })
  })

  it('reads a hint nested with the code, and keeps it on one line', async () => {
    const nested = await run([...update, '--json'], () =>
      Response.json(
        { error: { code: 'PLAN_LIMIT_EXCEEDED', hint: 'Pick 1d\n  or manual.' } },
        { status: 403 }
      )
    )
    expect(JSON.parse(nested.stderr).error.hint).toBe('Pick 1d or manual.')
  })

  it("keeps the CLI's own next step where it has one, and fills in where it has none", async () => {
    const hintFor = async (status: number, body: object) => {
      const result = await run([...update, '--json'], () =>
        Response.json({ hint: 'Just try again.', ...body }, { status })
      )
      return (JSON.parse(result.stderr) as { error: { hint?: string } }).error.hint
    }
    expect(await hintFor(429, {})).toContain('same --idempotency-key')
    expect(await hintFor(503, { code: 'BUSY' })).toContain('same --idempotency-key')
    expect(await hintFor(409, { code: 'RETRY_CONFLICT' })).toContain('nothing new ran')
    expect(await hintFor(409, { code: 'SCHEDULE_REFUSED', reason: 'STALE_APPROVAL' })).toContain(
      'teler schedule file quote'
    )
    expect(await hintFor(401, {})).toContain('teler auth login')
    expect(await hintFor(400, { code: 'SOMETHING_NEW' })).toBe('Just try again.')
  })

  it('falls back to its own hint when the body has none or an unprintable one', async () => {
    for (const hint of [undefined, '', 42, 'Pick \u001b[31m1d', 'Pick \u202e1d', 'x'.repeat(501)]) {
      const result = await run([...update, '--json'], refuse(hint === undefined ? {} : { hint }))
      const { error } = JSON.parse(result.stderr) as { error: { hint?: string } }
      expect(error.hint).toContain("organization's plan")
      expect(result.stderr).not.toContain('\u001b')
      expect(result.stderr).not.toContain('\u202e')
    }
  })
})
