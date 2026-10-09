import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'
import type { CredentialStore } from '../src/credentials'

const store: CredentialStore = {
  get: async () => 'token-secret',
  set: async () => undefined,
  delete: async () => undefined,
}

describe('file and upload command parser', () => {
  it('parses file listing options and emits stable JSON', async () => {
    let requested = ''
    let stdout = ''
    const exitCode = await main(
      [
        'files',
        'list',
        '/personal/reports',
        '--query',
        'revenue',
        '--scope',
        'personal',
        '--kind',
        'text',
        '--limit',
        '25',
        '--offset',
        '5',
        '--org',
        'org_test',
        '--json',
      ],
      {
        store,
        writeOut: (text) => (stdout += text),
        fetch: async (url) => {
          requested = url
          return Response.json({ path: '/personal/reports', children: [], truncated: true })
        },
      }
    )

    expect(exitCode).toBe(0)
    expect(new URL(requested).pathname).toBe('/api/files/tree')
    expect(Object.fromEntries(new URL(requested).searchParams)).toEqual({
      organizationId: 'org_test',
      path: '/personal/reports',
      query: 'revenue',
      limit: '25',
      offset: '5',
      kind: 'text',
      scope: 'personal',
    })
    expect(JSON.parse(stdout)).toEqual({
      path: '/personal/reports',
      children: [],
      truncated: true,
    })
  })

  it('parses file mutations', async () => {
    let body: unknown
    const exitCode = await main(
      ['files', 'write', '/personal/note.txt', 'hello', '--org', 'org_test', '--json'],
      {
        store,
        writeOut: () => undefined,
        fetch: async (_url, init) => {
          body = JSON.parse(String(init?.body))
          return Response.json({ path: '/personal/note.txt', type: 'txt' }, { status: 201 })
        },
      }
    )

    expect(exitCode).toBe(0)
    expect(body).toEqual({
      organizationId: 'org_test',
      path: '/personal/note.txt',
      content: 'hello',
    })
  })

  it('parses upload list filters', async () => {
    let requested = ''
    const exitCode = await main(
      ['upload', 'list', '--org', 'org_test', '--status', 'processing', '--limit', '8', '--json'],
      {
        store,
        writeOut: () => undefined,
        fetch: async (url) => {
          requested = url
          return Response.json({ items: [] })
        },
      }
    )

    expect(exitCode).toBe(0)
    expect(Object.fromEntries(new URL(requested).searchParams)).toEqual({
      organizationId: 'org_test',
      limit: '8',
      status: 'processing',
    })
  })

  it('rejects invalid scopes and limits before making a request', async () => {
    let requests = 0
    let stderr = ''
    const exitCode = await main(['files', 'list', '--scope', 'global', '--limit', '0'], {
      store,
      writeErr: (text) => (stderr += text),
      fetch: async () => {
        requests += 1
        return Response.json({})
      },
    })

    expect(exitCode).toBe(2)
    expect(requests).toBe(0)
    expect(stderr).toContain('--scope')
  })

  it('rejects --org for upload status instead of ignoring it', async () => {
    let requests = 0
    const exitCode = await main(['upload', 'status', 'fpjob_test', '--org', 'org_test'], {
      store,
      writeErr: () => undefined,
      fetch: async () => {
        requests += 1
        return Response.json({})
      },
    })

    expect(exitCode).toBe(2)
    expect(requests).toBe(0)
  })
})
