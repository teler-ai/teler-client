import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/index'

const ORG = 'org_01m2mgs69ge8nvmkdg6924cgg9'
const MEMORY = 'umem_01m2mgs69ge8nvmkdg6924cgg9'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

async function contentFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'teler-resource-scope-'))
  directories.push(directory)
  const path = join(directory, 'content.md')
  await writeFile(path, 'Prefer concise answers.')
  return path
}

describe('explicit resource scope', () => {
  it('sends the selected organization for every memory verb', async () => {
    const file = await contentFile()
    const commands = [
      ['list'],
      ['get', MEMORY],
      [
        'create',
        '--name',
        'tone',
        '--label',
        'Tone',
        '--description',
        'Tone',
        '--type',
        'preference',
        '--content-file',
        file,
      ],
      ['update', MEMORY, '--inactive'],
      ['delete', MEMORY, '--yes'],
    ]
    const requests: Array<{ path: string; query: string; method: string }> = []
    const memory = { id: MEMORY, name: 'tone', label: 'Tone', type: 'preference', active: true }
    for (const args of commands) {
      const code = await main(['memory', ...args, '--org', ORG, '--json'], {
        env: { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'token' },
        writeOut: () => undefined,
        writeErr: () => undefined,
        fetch: async (url, init) => {
          const parsed = new URL(url)
          const method = init?.method ?? 'GET'
          requests.push({ path: parsed.pathname, query: parsed.search, method })
          return method === 'DELETE'
            ? new Response(null, { status: 204 })
            : Response.json(method === 'GET' ? { memories: [memory] } : { memory })
        },
      })
      expect(code).toBe(0)
    }
    expect(requests).toEqual(
      [
        ['GET', '/api/memory'],
        ['GET', '/api/memory'],
        ['POST', '/api/memory'],
        ['PATCH', `/api/memory/${MEMORY}`],
        ['DELETE', `/api/memory/${MEMORY}`],
      ].map(([method, path]) => ({ method, path, query: `?organizationId=${ORG}` }))
    )
  })

  it('rejects direct organization skill creation with reviewed-copy guidance before requests', async () => {
    let requests = 0
    let stderr = ''
    const code = await main(
      [
        'skill',
        'create',
        '--name',
        'tone',
        '--label',
        'Tone',
        '--description',
        'Tone',
        '--content-file',
        await contentFile(),
        '--scope',
        'organization',
        '--org',
        ORG,
      ],
      {
        env: { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'token' },
        writeOut: () => undefined,
        writeErr: (text) => {
          stderr += text
        },
        fetch: async () => {
          requests += 1
          return Response.json({})
        },
      }
    )
    expect(code).toBe(2)
    expect(requests).toBe(0)
    expect(stderr).toContain('reviewed copy')
    expect(stderr).toContain('personal')
    expect(stderr).toContain('Knowledge')
  })
})
