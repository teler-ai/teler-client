import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const organizationId = `org_${suffix}`
const membershipId = `member_${suffix}`
const endpoint = `/api/organization/${organizationId}/agent-access-policy`
const env = { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'private-token' }

function policyResponse(revision = 7, decision = 'allow', rules: readonly unknown[] = []) {
  return {
    success: true,
    data: {
      organizationId,
      membershipId,
      viewerRole: 'member',
      canManageOrganizationPolicy: false,
      organization: {
        revision: 3,
        policy: { formatVersion: 1, catalogVersion: 1, default: 'permitted', rules: [] },
      },
      member: {
        revision,
        policy: { formatVersion: 1, catalogVersion: 1, default: decision, rules },
      },
      chat: null,
      untrustedDetail: 'private-response',
    },
  }
}

describe('own member Agent Access controls', () => {
  it('shows policy metadata without emitting rules or unrelated response fields', async () => {
    let output = ''
    expect(
      await main(['agent-access', 'show', '--org', organizationId, '--json'], {
        env,
        writeOut: (text) => {
          output += text
        },
        fetch: async (url) => {
          expect(new URL(url).pathname).toBe(endpoint)
          return Response.json(policyResponse(7, 'allow', [{ private: 'private-rule' }]))
        },
      })
    ).toBe(0)
    expect(JSON.parse(output)).toEqual({
      organizationId,
      membershipId,
      organizationPolicy: { revision: 3, default: 'permitted', ruleCount: 0 },
      memberPolicy: { revision: 7, default: 'allow', ruleCount: 1 },
    })
    for (const secret of ['private-token', 'private-response', 'private-rule']) {
      expect(output).not.toContain(secret)
    }
  })

  it.each([
    { decision: 'allow', rules: [] },
    { decision: 'ask', rules: [{ private: 'private-rule' }] },
  ])(
    'sets the Ask preset with the observed revision and preserves chat overrides: %s',
    async ({ decision, rules }) => {
      const requests: Array<{ path: string; method: string; body: unknown }> = []
      let output = ''
      expect(
        await main(['agent-access', 'set', '--org', organizationId, '--preset', 'ask', '--json'], {
          env,
          writeOut: (text) => {
            output += text
          },
          fetch: async (url, init) => {
            const method = init?.method ?? 'GET'
            requests.push({
              path: new URL(url).pathname,
              method,
              body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
            })
            expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-token')
            return Response.json(
              method === 'PATCH' ? policyResponse(8, 'ask') : policyResponse(7, decision, rules)
            )
          },
        })
      ).toBe(0)
      expect(requests).toEqual([
        { path: endpoint, method: 'GET', body: undefined },
        {
          path: endpoint,
          method: 'PATCH',
          body: {
            scope: 'member',
            expectedRevision: 7,
            existingChatOverrides: 'preserve',
            policy: { formatVersion: 1, catalogVersion: 1, default: 'ask', rules: [] },
          },
        },
      ])
      expect(JSON.parse(output).memberPolicy).toEqual({ revision: 8, default: 'ask', ruleCount: 0 })
    }
  )

  it('resolves the session active organization when no org option is supplied', async () => {
    const paths: string[] = []
    expect(
      await main(['agent-access', 'show', '--json'], {
        env,
        writeOut: () => undefined,
        fetch: async (url) => {
          paths.push(new URL(url).pathname)
          return Response.json(
            paths.length === 1 ? { activeOrganizationId: organizationId } : policyResponse()
          )
        },
      })
    ).toBe(0)
    expect(paths).toEqual(['/api/teler-cli/me', endpoint])
  })

  it('reports success without a mutation when the member already has the Ask preset', async () => {
    const methods: string[] = []
    let output = ''
    expect(
      await main(['agent-access', 'set', '--org', organizationId, '--preset', 'ask', '--json'], {
        env,
        writeOut: (text) => {
          output += text
        },
        writeErr: () => undefined,
        fetch: async (_url, init) => {
          const method = init?.method ?? 'GET'
          methods.push(method)
          return method === 'GET'
            ? Response.json(policyResponse(7, 'ask'))
            : Response.json({ error: 'policy_unchanged' }, { status: 422 })
        },
      })
    ).toBe(0)
    expect(methods).toEqual(['GET'])
    expect(JSON.parse(output).memberPolicy).toEqual({ revision: 7, default: 'ask', ruleCount: 0 })
  })

  it('rejects unsupported presets, unsafe org IDs and extra scope flags before HTTP', async () => {
    let calls = 0
    for (const argv of [
      ['agent-access', 'set', '--org', organizationId],
      ['agent-access', 'set', '--org', organizationId, '--preset', 'standard'],
      [
        'agent-access',
        'set',
        '--org',
        organizationId,
        '--preset',
        'ask',
        '--scope',
        'organization',
      ],
      ['agent-access', 'show', '--org', '../other'],
      ['agent-access', 'show', '--preset', 'ask'],
    ]) {
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
    }
    expect(calls).toBe(0)
  })

  it('does not retry a concurrent policy update or echo the refusal body', async () => {
    let calls = 0
    let error = ''
    expect(
      await main(['agent-access', 'set', '--org', organizationId, '--preset', 'ask'], {
        env,
        writeErr: (text) => {
          error += text
        },
        fetch: async () => {
          calls += 1
          return calls === 1
            ? Response.json(policyResponse())
            : Response.json({ error: 'private-refusal' }, { status: 409 })
        },
      })
    ).toBe(1)
    expect(calls).toBe(2)
    expect(error).toBe('teler: Teler API request failed (409)\n')
  })

  it('refuses a mismatched organization before attempting any policy mutation', async () => {
    let calls = 0
    let error = ''
    const response = policyResponse()
    response.data.organizationId = 'org_01m2mgs69ge8nvmkdg6924cgg9'
    expect(
      await main(['agent-access', 'set', '--org', organizationId, '--preset', 'ask'], {
        env,
        writeErr: (text) => {
          error += text
        },
        fetch: async () => {
          calls += 1
          return Response.json(response)
        },
      })
    ).toBe(1)
    expect(calls).toBe(1)
    expect(error).toBe('teler: Teler API returned an invalid response\n')
  })

  it('rejects unsupported policy versions without leaking the response', async () => {
    let calls = 0
    let error = ''
    const response = policyResponse()
    response.data.member.policy.catalogVersion = 2
    expect(
      await main(['agent-access', 'set', '--org', organizationId, '--preset', 'ask'], {
        env,
        writeErr: (text) => {
          error += text
        },
        fetch: async () => {
          calls += 1
          return Response.json(response)
        },
      })
    ).toBe(1)
    expect(calls).toBe(1)
    expect(error).toBe('teler: Teler API returned an invalid response\n')
  })
})
