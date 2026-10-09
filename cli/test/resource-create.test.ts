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
const MEMORY_ID = 'umem_01m2k72d22fqe8ww472ycs3px3'
const AGENT_ID = 'agent_01m2k72d22fqe8ww472ycs3px3'
const ORG_ID = 'org_01m2mgs69ge8nvmkdg6924cgg9'
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('resource create commands', () => {
  it('creates memories and agents with their resource-specific fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'teler-cli-resource-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'content.md')
    await writeFile(path, 'Use this content.', 'utf8')
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      requests.push({ url: String(url), body })
      if (String(url).endsWith('/api/memory')) {
        return Response.json({
          memory: {
            id: MEMORY_ID,
            name: body.name,
            label: body.label,
            type: body.type,
            active: true,
          },
        })
      }
      return Response.json({
        id: AGENT_ID,
        name: body.name,
        label: body.label,
        scope: body.scope,
      })
    }

    expect(
      await main(
        [
          'memory',
          'create',
          '--name',
          'tone',
          '--label',
          'Tone',
          '--description',
          'Preferred tone',
          '--content-file',
          path,
          '--type',
          'preference',
        ],
        { store, fetch, writeOut: () => undefined }
      )
    ).toBe(0)
    expect(
      await main(
        [
          'agent',
          'create',
          '--org',
          ORG_ID,
          '--name',
          'weekly-report',
          '--label',
          'Weekly report',
          '--content-file',
          path,
          '--model-set',
          'lite',
          '--quick-action',
        ],
        { store, fetch, writeOut: () => undefined }
      )
    ).toBe(0)
    expect(requests).toEqual([
      {
        url: 'https://app.teler.ai/api/memory',
        body: {
          name: 'tone',
          label: 'Tone',
          content: 'Use this content.',
          description: 'Preferred tone',
          type: 'preference',
        },
      },
      {
        url: 'https://app.teler.ai/api/agent',
        body: {
          name: 'weekly-report',
          label: 'Weekly report',
          content: 'Use this content.',
          scope: 'personal',
          modelSet: 'lite',
          offerAsQuickAction: true,
          organizationId: ORG_ID,
        },
      },
    ])
  })
})
