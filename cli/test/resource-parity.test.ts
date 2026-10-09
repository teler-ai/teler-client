import { describe, expect, it } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../src/index'

const org = 'org_01m2mgs69ge8nvmkdg6924cgg9'
const dashboard = 'dash_01m2mgs69ge8nvmkdg6924cgg9'
const post = 'post_01m2mgs69ge8nvmkdg6924cgg9'
const base = {
  env: { TELER_TOKEN: 'test-token', TELER_URL: 'https://app.teler.ai' },
  writeOut: () => undefined,
  writeErr: () => undefined,
}

describe('canonical dashboard and post operations', () => {
  it('reads post values and artifact source through the canonical API', async () => {
    for (const args of [
      ['post', 'get', post, '--include', 'data'],
      ['artifact', 'source', 'artifact_01m2mgs69ge8nvmkdg6924cgg9'],
    ]) {
      let output = ''
      const status = await main([...args, '--org', org, '--json'], {
        ...base,
        writeOut: (text) => {
          output += text
        },
        fetch: async (url) => {
          const parsed = new URL(url)
          if (args[0] === 'post') {
            expect(parsed.searchParams.get('include')).toBe('data')
            return Response.json({ id: post, artifactData: [{ data: [42] }] })
          }
          expect(parsed.pathname).toBe(`/api/artifact/${args[2]}/source`)
          return Response.json({ timestamp: '2026-09-30T00:00:00.000Z', source: 'print(42)' })
        },
      })
      expect(status).toBe(0)
      expect(JSON.parse(output)).toHaveProperty(args[0] === 'post' ? 'artifactData' : 'source')
    }
  })
  it('sends atomic dashboard edits unchanged through the canonical API', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'teler-parity-'))
    try {
      const file = join(dir, 'patch.json')
      const patch = {
        expectedRevision: 'revision',
        dashboard: { name: 'Revised' },
        widgets: { remove: ['widget'] },
      }
      await writeFile(file, JSON.stringify(patch))
      let request: RequestInit | undefined
      let path = ''
      const status = await main(['dashboard', 'update', dashboard, '--org', org, '--file', file], {
        ...base,
        fetch: async (url, init) => {
          path = new URL(url).pathname
          request = init
          return Response.json({ id: dashboard })
        },
      })
      expect(status).toBe(0)
      expect(path).toBe(`/api/dashboard/${dashboard}`)
      expect(request?.method).toBe('PATCH')
      expect(JSON.parse(String(request?.body))).toEqual(patch)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('supports data-only reads and preserves the complete response', async () => {
    let output = ''
    const status = await main(
      ['dashboard', 'get', dashboard, '--include', 'data', '--org', org, '--json'],
      {
        ...base,
        writeOut: (text) => {
          output += text
        },
        fetch: async (url) => {
          expect(new URL(url).searchParams.get('include')).toBe('data')
          return Response.json({ id: dashboard, revision: 'r1', widgetData: [{ values: [1, 2] }] })
        },
      }
    )
    expect(status).toBe(0)
    expect(JSON.parse(output).widgetData).toEqual([{ values: [1, 2] }])
  })
  it('requires explicit delete confirmation before making a request', async () => {
    let called = false
    expect(
      await main(['post', 'delete', post, '--org', org], {
        ...base,
        fetch: async () => {
          called = true
          return new Response(null, { status: 204 })
        },
      })
    ).toBe(2)
    expect(called).toBe(false)
    expect(
      await main(['post', 'delete', post, '--org', org, '--yes'], {
        ...base,
        fetch: async (url, init) => {
          expect(new URL(url).pathname).toBe(`/api/post/${post}`)
          expect(init?.method).toBe('DELETE')
          return new Response(null, { status: 204 })
        },
      })
    ).toBe(0)
  })
  it('uses canonical shared-resource interaction routes', async () => {
    expect(
      await main(['post', 'comments', post, '--org', org], {
        ...base,
        fetch: async (url) => {
          expect(new URL(url).pathname).toBe(`/api/post/${post}/comment`)
          return Response.json({ items: [] })
        },
      })
    ).toBe(0)
  })
  it('passes bounded document selectors and dashboard widget filters to the canonical reads', async () => {
    const document = 'doc_01m2mgs69ge8nvmkdg6924cgg9'
    expect(
      await main(
        [
          'post',
          'document',
          post,
          document,
          '--org',
          org,
          '--max-bytes',
          '4096',
          '--page-number',
          '2',
          '--anchor',
          'section',
          '--cursor',
          'next',
        ],
        {
          ...base,
          fetch: async (url) => {
            const parsed = new URL(url)
            expect(parsed.pathname).toBe(`/api/post/${post}/document/${document}/content`)
            expect(Object.fromEntries(parsed.searchParams)).toMatchObject({
              max_bytes: '4096',
              page_number: '2',
              anchor: 'section',
              cursor: 'next',
            })
            return Response.json({ text: 'selected content' })
          },
        }
      )
    ).toBe(0)
    expect(
      await main(['dashboard', 'get', dashboard, '--org', org, '--widget-ids', 'first,second'], {
        ...base,
        fetch: async (url) => {
          expect(new URL(url).searchParams.get('widgetIds')).toBe('first,second')
          return Response.json({ id: dashboard })
        },
      })
    ).toBe(0)
  })
  it('downloads attached artifact bytes through the authenticated post route', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'teler-attachment-'))
    try {
      const file = join(dir, 'attachment.bin')
      expect(
        await main(
          [
            'post',
            'artifact',
            post,
            'art_01m2mgs69ge8nvmkdg6924cgg9',
            '--org',
            org,
            '--download',
            '--output',
            file,
          ],
          {
            ...base,
            fetch: async (url) => {
              expect(new URL(url).searchParams.get('download')).toBe('true')
              return new Response(new Uint8Array([1, 2, 255]))
            },
          }
        )
      ).toBe(0)
      expect([...(await readFile(file))]).toEqual([1, 2, 255])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('rejects invalid include and unsupported flags before requests', async () => {
    expect(
      await main(['dashboard', 'get', dashboard, '--org', org, '--include', 'true'], base)
    ).toBe(2)
    expect(await main(['post', 'get', post, '--org', org, '--include', 'invalid'], base)).toBe(2)
  })
})
