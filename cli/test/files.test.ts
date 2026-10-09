import { describe, expect, it } from 'bun:test'
import { TelerApiClient } from '../src/api'
import {
  copyFile,
  listFiles,
  mkdir,
  moveFile,
  readFiles,
  searchFiles,
  writeFile,
} from '../src/files'
import { runFileCommand } from '../src/file-command'

const output = (json = true) => {
  let value = ''
  return {
    target: { json, metadataOnly: false, write: (text: string) => (value += text) },
    read: () => value,
  }
}

describe('file commands', () => {
  it('lists a nested tree with organization resolution and discovery filters', async () => {
    const requests: string[] = []
    const client = new TelerApiClient(new URL('https://app.teler.ai'), 'token', async (url) => {
      requests.push(url)
      if (requests.length === 1) {
        return Response.json({ activeOrganizationId: 'org_test' })
      }
      return Response.json({
        path: '/personal/reports',
        children: [
          {
            name: 'q1.txt',
            kind: 'text',
            type: 'txt',
            fileId: 'doc_test',
            version: 2,
            scope: 'personal',
            sizeBytes: 12,
          },
        ],
        truncated: true,
      })
    })
    const sink = output()

    await listFiles(client, sink.target, {
      path: '/personal/reports',
      query: 'q1',
      kind: 'text',
      scope: 'personal',
      limit: 25,
      offset: 5,
    })

    const url = new URL(requests[1] ?? '')
    expect(url.pathname).toBe('/api/files/tree')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      organizationId: 'org_test',
      path: '/personal/reports',
      query: 'q1',
      kind: 'text',
      scope: 'personal',
      limit: '25',
      offset: '5',
    })
    expect(JSON.parse(sink.read())).toMatchObject({
      path: '/personal/reports',
      truncated: true,
      children: [{ name: 'q1.txt', fileId: 'doc_test', sizeBytes: 12 }],
    })
  })

  it('prints nested tree paths without flattening JSON output', async () => {
    const client = new TelerApiClient(new URL('https://app.teler.ai'), 'token', async (_url) => {
      return Response.json({
        path: '/personal/reports',
        children: [
          {
            name: '2026',
            kind: 'folder',
            children: [
              {
                name: 'q1.txt',
                kind: 'text',
                type: 'txt',
                fileId: 'doc_test',
                version: 1,
                scope: 'personal',
              },
            ],
          },
        ],
      })
    })
    const sink = output(false)

    await listFiles(client, sink.target, {
      organizationId: 'org_test',
      path: '/personal/reports',
    })

    expect(sink.read()).toContain('/personal/reports/2026/q1.txt\ttext')
  })

  it('lists the root by default and does not automatically fetch another page', async () => {
    let requested = ''
    let calls = 0
    const client = new TelerApiClient(new URL('https://app.teler.ai'), 'token', async (url) => {
      calls += 1
      requested = url
      return Response.json({ path: '/', children: [], truncated: true })
    })

    await listFiles(client, output().target, { organizationId: 'org_test' })

    expect(new URL(requested).pathname).toBe('/api/files/tree')
    expect(new URL(requested).searchParams.get('path')).toBe('/')
    expect(calls).toBe(1)
  })

  it('parses list flags for path, query, kind, scope, limit and offset', async () => {
    let requested = ''
    const client = new TelerApiClient(new URL('https://app.teler.ai'), 'token', async (url) => {
      requested = url
      return Response.json({ path: '/organization/reports', children: [] })
    })
    await runFileCommand(client, output().target, 'list', [
      '--org',
      'org_test',
      '--path',
      '/organization/reports',
      '--query',
      'revenue',
      '--kind',
      'text,table',
      '--scope',
      'organization',
      '--limit',
      '20',
      '--offset',
      '7',
    ])
    expect(Object.fromEntries(new URL(requested).searchParams)).toEqual({
      organizationId: 'org_test',
      path: '/organization/reports',
      query: 'revenue',
      kind: 'text,table',
      scope: 'organization',
      limit: '20',
      offset: '7',
    })
  })

  it('reads and searches files with runtime-validated responses', async () => {
    const bodies: unknown[] = []
    const client = new TelerApiClient(
      new URL('https://app.teler.ai'),
      'token',
      async (_url, init) => {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined)
        if (bodies.length === 1)
          return Response.json({
            items: [
              {
                path: '/personal/a.txt',
                type: 'txt',
                kind: 'text',
                scope: 'personal',
                text: 'hello',
              },
            ],
          })
        return Response.json({
          items: [
            {
              path: '/personal/a.txt',
              kind: 'text',
              snippet: 'hello',
              score: 1,
              scope: 'personal',
            },
          ],
        })
      }
    )
    const sink = output()

    await readFiles(client, sink.target, { organizationId: 'org_test', paths: ['/personal/a.txt'] })
    await searchFiles(client, sink.target, {
      organizationId: 'org_test',
      query: 'hello',
      path: '/personal',
      scope: 'personal',
      limit: 5,
    })

    expect(bodies).toEqual([
      { organizationId: 'org_test', paths: ['/personal/a.txt'] },
      {
        organizationId: 'org_test',
        query: 'hello',
        glob: '/personal/**',
        scope: ['personal'],
        limit: 5,
      },
    ])
  })

  it('performs write, mkdir, move, and copy mutations', async () => {
    const seen: Array<{ path: string; body: unknown }> = []
    const client = new TelerApiClient(
      new URL('https://app.teler.ai'),
      'token',
      async (url, init) => {
        const path = new URL(url).pathname
        seen.push({ path, body: JSON.parse(String(init?.body)) })
        if (path.endsWith('/mkdir'))
          return Response.json(
            { path: '/personal/a', type: 'folder', scope: 'personal' },
            { status: 201 }
          )
        if (path.endsWith('/move') || path.endsWith('/copy'))
          return Response.json(JSON.parse(String(init?.body)), { status: 201 })
        return Response.json({ path: '/personal/a/note.txt', type: 'txt' }, { status: 201 })
      }
    )
    const sink = output()

    await writeFile(client, sink.target, {
      organizationId: 'org_test',
      path: '/personal/a/note.txt',
      content: 'hello',
    })
    await mkdir(client, sink.target, { organizationId: 'org_test', path: '/personal/a' })
    await moveFile(client, sink.target, {
      organizationId: 'org_test',
      from: '/personal/a/note.txt',
      to: '/personal/a/moved.txt',
    })
    await copyFile(client, sink.target, {
      organizationId: 'org_test',
      from: '/personal/a/moved.txt',
      to: '/personal/a/copy.txt',
    })

    expect(seen.map((entry) => entry.path)).toEqual([
      '/api/files',
      '/api/files/mkdir',
      '/api/files/move',
      '/api/files/copy',
    ])
  })

  it('rejects malformed server responses', async () => {
    const client = new TelerApiClient(new URL('https://app.teler.ai'), 'token', async () =>
      Response.json({ items: [{ path: 42 }] })
    )
    await expect(
      listFiles(client, output().target, { organizationId: 'org_test' })
    ).rejects.toThrow('invalid response')
  })

  it('rejects cursor fields instead of treating them as part of the tree contract', async () => {
    const client = new TelerApiClient(new URL('https://app.teler.ai'), 'token', async () =>
      Response.json({ path: '/', children: [], nextCursor: 'private-token' })
    )
    await expect(
      listFiles(client, output().target, { organizationId: 'org_test' })
    ).rejects.toThrow('invalid response')
  })
})
