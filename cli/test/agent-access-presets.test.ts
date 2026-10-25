import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const organizationId = `org_${suffix}`
const membershipId = `member_${suffix}`
const env = { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'private-token' }

const allow = (capability: string) => ({ selector: { capability }, decision: 'allow' })
const PRESETS = {
  standard: {
    default: 'ask',
    rules: [
      { selector: { category: 'web' }, decision: 'ask' },
      ...[
        'connectors.discover',
        'connectors.query',
        'tables.metadata.read',
        'tables.rows.read',
        'files.metadata.read',
        'files.content.read',
        'decisions.run',
      ].map(allow),
    ],
  },
  ask: { default: 'ask', rules: [] },
  'read-only': {
    default: 'never',
    rules: [
      'web.search',
      'web.fetch',
      'connectors.discover',
      'connectors.query',
      'files.metadata.read',
      'files.content.read',
      'tables.metadata.read',
      'tables.rows.read',
    ].map(allow),
  },
  'allow-everything': { default: 'allow', rules: [] },
} as const

function policyResponse(revision: number, policy: { default: string; rules: readonly unknown[] }) {
  return {
    success: true,
    data: {
      organizationId,
      membershipId,
      organization: {
        revision: 3,
        policy: { formatVersion: 1, catalogVersion: 1, default: 'permitted', rules: [] },
      },
      member: { revision, policy: { formatVersion: 1, catalogVersion: 1, ...policy } },
    },
  }
}

async function set(argv: string[], current: { default: string; rules: readonly unknown[] }) {
  const patches: unknown[] = []
  let stdout = ''
  let stderr = ''
  const exitCode = await main(['agent-access', 'set', '--org', organizationId, ...argv], {
    env,
    writeOut: (text) => (stdout += text),
    writeErr: (text) => (stderr += text),
    fetch: async (_url, init) => {
      if (init?.method !== 'PATCH') return Response.json(policyResponse(7, current))
      const body = JSON.parse(String(init.body)) as { policy: { default: string; rules: [] } }
      patches.push(body)
      return Response.json(policyResponse(8, body.policy))
    },
  })
  return { exitCode, stdout, stderr, patches }
}

describe('teler agent-access set, any preset the app offers', () => {
  for (const [preset, policy] of Object.entries(PRESETS)) {
    it(`sets the ${preset} preset as the app writes it`, async () => {
      const confirm = preset === 'allow-everything' ? ['--yes'] : []
      const result = await set(['--preset', preset, ...confirm, '--json'], {
        default: 'ask',
        rules: [{ x: 1 }],
      })
      expect(result.exitCode).toBe(0)
      expect(result.patches).toEqual([
        {
          scope: 'member',
          expectedRevision: 7,
          existingChatOverrides: 'preserve',
          policy: { formatVersion: 1, catalogVersion: 1, ...policy },
        },
      ])
      expect(JSON.parse(result.stdout).memberPolicy).toMatchObject({ revision: 8, preset })
    })
  }

  it('changes nothing when that preset is already set', async () => {
    const result = await set(['--preset', 'read-only'], PRESETS['read-only'])
    expect(result.exitCode).toBe(0)
    expect(result.patches).toEqual([])
    expect(result.stdout).toContain('preset read-only')
  })

  it('asks for --yes before letting Agents do everything without asking', async () => {
    const result = await set(['--preset', 'allow-everything'], PRESETS.ask)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--yes')
    expect(result.patches).toEqual([])
  })

  it('shows which preset is in force, or custom', async () => {
    let stdout = ''
    await main(['agent-access', 'show', '--org', organizationId, '--json'], {
      env,
      writeOut: (text) => (stdout += text),
      fetch: async () => Response.json(policyResponse(7, PRESETS.standard)),
    })
    expect(JSON.parse(stdout).memberPolicy.preset).toBe('standard')
    stdout = ''
    await main(['agent-access', 'show', '--org', organizationId, '--json'], {
      env,
      writeOut: (text) => (stdout += text),
      fetch: async () =>
        Response.json(policyResponse(7, { default: 'ask', rules: [allow('files.create')] })),
    })
    expect(JSON.parse(stdout).memberPolicy.preset).toBe('custom')
  })
})
