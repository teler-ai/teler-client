import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/index'
import type { CredentialStore } from '../src/credentials'

const store: CredentialStore = {
  get: async () => 'token-secret',
  set: async () => undefined,
  delete: async () => undefined,
}

const SKILL_ID = 'skll_01m2k72d22fqe8ww472ycs3px3'
const MEMORY_ID = 'umem_01m2k72d22fqe8ww472ycs3px3'
const AGENT_ID = 'agent_01m2k72d22fqe8ww472ycs3px3'
const ORG_ID = 'org_01m2mgs69ge8nvmkdg6924cgg9'
const temporaryDirectories: string[] = []

async function contentFile(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'teler-cli-resource-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'content.md')
  await writeFile(path, content, 'utf8')
  return path
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('resource CRUD commands', () => {
  it('documents resource fields and destructive confirmation', async () => {
    let output = ''
    expect(await main(['--help'], { writeOut: (text) => (output += text) })).toBe(0)
    expect(output).toContain('teler skill  create --name <slug>')
    expect(output).toContain('teler memory list [--json]')
    expect(output).toContain('teler memory get <id> [--json]')
    expect(output).toContain('teler memory delete <id> --yes [--json]')
    expect(output).toContain('--type preference|domain|feedback|reference')
    expect(output).toContain('--quick-action|--no-quick-action')
    expect(output).toContain('teler agent  delete <id> --yes')
  })

  it('creates a personal skill from a content file', async () => {
    const path = await contentFile('# Forecasting\nUse conservative intervals.')
    let request: { url: string; init?: RequestInit } | undefined
    let output = ''
    const exitCode = await main(
      [
        'skill',
        'create',
        '--org',
        ORG_ID,
        '--name',
        'forecasting',
        '--label',
        'Forecasting',
        '--description',
        'Forecasting guidance',
        '--content-file',
        path,
        '--trigger',
        'forecast',
        '--trigger',
        'projection',
        '--json',
      ],
      {
        store,
        writeOut: (text) => (output += text),
        fetch: async (url, init) => {
          request = { url, init }
          return Response.json(
            {
              id: SKILL_ID,
              name: 'forecasting',
              label: 'Forecasting',
              description: 'Forecasting guidance',
              scope: 'personal',
              triggers: ['forecast', 'projection'],
            },
            { status: 201 }
          )
        },
      }
    )

    expect(exitCode).toBe(0)
    expect(request?.url).toBe('https://app.teler.ai/api/skills')
    expect(request?.init?.method).toBe('POST')
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      name: 'forecasting',
      label: 'Forecasting',
      description: 'Forecasting guidance',
      content: '# Forecasting\nUse conservative intervals.',
      triggers: ['forecast', 'projection'],
      scope: 'personal',
      organizationId: ORG_ID,
    })
    expect(JSON.parse(output).id).toBe(SKILL_ID)
  })

  it('lists and gets skills for the selected organization', async () => {
    const requests: string[] = []
    let output = ''
    const skill = {
      id: SKILL_ID,
      name: 'forecasting',
      label: 'Forecasting',
      description: 'Guidance',
      scope: 'personal',
      triggers: null,
      isActive: true,
      isOwnSkill: true,
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z',
    }
    const fetch = async (url: string | URL | Request) => {
      requests.push(String(url))
      return Response.json(
        requests.length === 1
          ? { skills: [skill] }
          : { ...skill, content: '# x', organizationId: ORG_ID }
      )
    }

    expect(
      await main(['skill', 'list', '--org', ORG_ID, '--json'], {
        store,
        fetch,
        writeOut: (text) => (output += text),
      })
    ).toBe(0)
    expect(JSON.parse(output).skills).toHaveLength(1)

    output = ''
    expect(
      await main(['skill', 'get', SKILL_ID, '--json'], {
        store,
        fetch,
        writeOut: (text) => (output += text),
      })
    ).toBe(0)
    expect(JSON.parse(output).content).toBe('# x')
    expect(requests).toEqual([
      `https://app.teler.ai/api/skills?organizationId=${ORG_ID}`,
      `https://app.teler.ai/api/skills/${SKILL_ID}`,
    ])
  })

  it('reads one memory from the list and updates active state', async () => {
    const memory = {
      id: MEMORY_ID,
      userId: 'user_1',
      organizationId: ORG_ID,
      name: 'tone',
      label: 'Tone',
      description: 'Preferred tone',
      content: 'Be concise.',
      triggers: null,
      type: 'preference',
      active: true,
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z',
    }
    const requests: Array<{ url: string; init?: RequestInit }> = []
    let output = ''
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init })
      return Response.json(
        requests.length === 1 ? { memories: [memory] } : { memory: { ...memory, active: false } }
      )
    }

    expect(
      await main(['memory', 'get', MEMORY_ID, '--json'], {
        store,
        fetch,
        writeOut: (text) => (output += text),
      })
    ).toBe(0)
    expect(JSON.parse(output).name).toBe('tone')

    output = ''
    expect(
      await main(['memory', 'update', MEMORY_ID, '--inactive', '--json'], {
        store,
        fetch,
        writeOut: (text) => (output += text),
      })
    ).toBe(0)
    expect(requests[1]?.url).toBe(`https://app.teler.ai/api/memory/${MEMORY_ID}`)
    expect(requests[1]?.init?.method).toBe('PATCH')
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ active: false })
  })

  it('updates agent configuration with explicit boolean values', async () => {
    let request: { url: string; init?: RequestInit } | undefined
    const exitCode = await main(
      [
        'agent',
        'update',
        AGENT_ID,
        '--model-set',
        'pro',
        '--no-quick-action',
        '--output',
        'private_post',
        '--capabilities',
        'tables.metadata.read, tables.rows.read',
      ],
      {
        store,
        writeOut: () => undefined,
        fetch: async (url, init) => {
          request = { url, init }
          return Response.json({ id: AGENT_ID, name: 'weekly-report' })
        },
      }
    )

    expect(exitCode).toBe(0)
    expect(request?.url).toBe(`https://app.teler.ai/api/agent/${AGENT_ID}`)
    expect(request?.init?.method).toBe('PATCH')
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      modelSet: 'pro',
      offerAsQuickAction: false,
      output: 'private_post',
      capabilities: ['tables.metadata.read', 'tables.rows.read'],
    })
  })

  it('requires explicit confirmation before deletion', async () => {
    let requests = 0
    let stderr = ''
    const withoutConfirmation = await main(['agent', 'delete', AGENT_ID], {
      store,
      fetch: async () => {
        requests += 1
        return new Response(null, { status: 204 })
      },
      writeErr: (text) => (stderr += text),
    })
    expect(withoutConfirmation).toBe(2)
    expect(stderr).toContain('--yes')
    expect(requests).toBe(0)

    let output = ''
    const confirmed = await main(['agent', 'delete', AGENT_ID, '--yes', '--json'], {
      store,
      fetch: async () => {
        requests += 1
        return new Response(null, { status: 204 })
      },
      writeOut: (text) => (output += text),
    })
    expect(confirmed).toBe(0)
    expect(requests).toBe(1)
    expect(JSON.parse(output)).toEqual({ deleted: true, id: AGENT_ID })
  })

  it('says a deleted Agent can be restored for 30 days', async () => {
    let output = ''
    const status = await main(['agent', 'delete', AGENT_ID, '--yes'], {
      store,
      fetch: async () => new Response(null, { status: 204 }),
      writeOut: (text) => (output += text),
    })
    expect(status).toBe(0)
    expect(output).toBe(
      `Deleted agent ${AGENT_ID}. You can restore it from the Agents page for 30 days.\n`
    )
  })

  it('rejects empty updates and lifecycle flags before network access', async () => {
    let requests = 0
    for (const argv of [
      ['skill', 'update', SKILL_ID],
      ['memory', 'update', MEMORY_ID],
      ['agent', 'update', AGENT_ID, '--enable'],
    ]) {
      expect(
        await main(argv, {
          store,
          writeErr: () => undefined,
          fetch: async () => {
            requests += 1
            return Response.json({})
          },
        })
      ).toBe(2)
    }
    expect(requests).toBe(0)
  })
})
