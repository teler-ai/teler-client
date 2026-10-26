import { describe, expect, it } from 'bun:test'
import { TelerApiClient } from '../src/api'
import { CommandError, UsageError } from '../src/errors'
import { runFileCommand } from '../src/file-command'

const FILE_ID = 'doc_01m2k72d22fqe8ww472ycs3px3'
const UNTIL = '2026-11-25T11:08:35.096Z'

interface Call {
  method: string
  url: URL
}

function harness(answer: (call: Call) => Response, json = false) {
  const calls: Call[] = []
  let written = ''
  const client = new TelerApiClient(new URL('https://app.teler.ai'), 'token', async (url, init) => {
    const call = { method: init?.method ?? 'GET', url: new URL(url) }
    calls.push(call)
    if (call.url.pathname === '/api/teler-cli/me')
      return Response.json({ user: { id: 'user_1', name: null }, activeOrganizationId: 'org_test' })
    return answer(call)
  })
  const output = { json, metadataOnly: false, write: (text: string) => (written += text) }
  const run = (action: string, args: string[]) => runFileCommand(client, output, action, args)
  return { calls, run, written: () => written }
}

const tree = (children: unknown[]) => Response.json({ path: '/organization/reports', children })
const leaf = {
  name: 'q3.csv',
  kind: 'table',
  type: 'tabular-csv',
  fileId: FILE_ID,
  documentId: FILE_ID,
  version: 1,
  scope: 'organization',
}

describe('teler files delete', () => {
  it('moves a File named by its path to the trash and says until when it can be restored', async () => {
    const h = harness((call) =>
      call.url.pathname === '/api/files/tree'
        ? tree([{ ...leaf, name: 'q3.csv.bak' }, leaf])
        : Response.json({ deleted: 1, tablesDropped: 0, recoverableUntil: UNTIL })
    )

    await h.run('delete', ['/organization/reports/q3.csv', '--yes'])

    const lookup = h.calls.find((call) => call.url.pathname === '/api/files/tree')
    expect(Object.fromEntries(lookup?.url.searchParams ?? [])).toMatchObject({
      organizationId: 'org_test',
      path: '/organization/reports',
      glob: '/organization/reports/q3.csv',
    })
    const deleted = h.calls.at(-1)
    expect(deleted?.method).toBe('DELETE')
    expect(deleted?.url.pathname).toBe(`/api/documents/${FILE_ID}`)
    // Only the trash: the CLI never asks for a permanent delete.
    expect(deleted?.url.search).toBe('')
    expect(h.written()).toBe(
      `Moved to trash; restore until 2026-11-25 11:08 UTC with \`teler files restore ${FILE_ID}\`.\n`
    )
  })

  it('takes a File ID directly, and answers JSON', async () => {
    const h = harness(
      () => Response.json({ deleted: 1, tablesDropped: 0, recoverableUntil: UNTIL }),
      true
    )
    await h.run('delete', [FILE_ID, '--yes'])
    expect(h.calls.map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
      `DELETE /api/documents/${FILE_ID}`,
    ])
    expect(JSON.parse(h.written())).toEqual({
      id: FILE_ID,
      status: 'trashed',
      recoverableUntil: UNTIL,
    })
  })

  it('needs --yes, and sends nothing without it', async () => {
    const h = harness(() => Response.json({}))
    await expect(h.run('delete', [FILE_ID])).rejects.toBeInstanceOf(UsageError)
    expect(h.calls).toEqual([])
  })

  it('leaves a folder to the Teler app, and a missing path is reported', async () => {
    const folder = harness(() => tree([{ name: 'reports', kind: 'folder', children: [] }]))
    await expect(folder.run('delete', ['/organization/reports', '--yes'])).rejects.toMatchObject({
      code: 'FOLDER_DELETE_IN_APP',
    })
    expect(folder.calls.some((call) => call.method === 'DELETE')).toBe(false)

    const missing = harness(() => tree([leaf]))
    const error = await missing
      .run('delete', ['/organization/reports/q4.csv', '--yes'])
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CommandError)
    expect(error).toMatchObject({ code: 'NOT_FOUND' })
    expect(missing.calls.some((call) => call.method === 'DELETE')).toBe(false)
  })
})

describe('teler files restore', () => {
  it('restores a File from the trash by its ID', async () => {
    const h = harness(() => Response.json({ restored: 1 }))
    await h.run('restore', [FILE_ID])
    expect(h.calls.map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
      `POST /api/documents/${FILE_ID}/restore`,
    ])
    expect(h.written()).toBe(`Restored ${FILE_ID}.\n`)
  })

  it('needs the ID the trash shows, not a path', async () => {
    const h = harness(() => Response.json({}))
    await expect(h.run('restore', ['/organization/reports/q3.csv'])).rejects.toBeInstanceOf(
      UsageError
    )
    expect(h.calls).toEqual([])
  })
})

describe('teler files trash', () => {
  const item = {
    id: FILE_ID,
    name: 'q3.csv',
    path: 'reports/q3.csv',
    scope: 'organization',
    deletedAt: '2026-10-26T11:08:35.096Z',
    recoverableUntil: UNTIL,
  }

  it('lists the trash with until when each File can be restored', async () => {
    const h = harness(() => Response.json({ items: [item], total: 3 }))
    await h.run('trash', ['--limit', '1'])
    const list = h.calls.at(-1)
    expect(list?.url.pathname).toBe('/api/documents')
    expect(Object.fromEntries(list?.url.searchParams ?? [])).toEqual({
      organizationId: 'org_test',
      deleted: 'true',
      limit: '1',
      offset: '0',
    })
    expect(h.written()).toBe(
      `${FILE_ID}  reports/q3.csv  restore until 2026-11-25 11:08 UTC\n2 more; use --offset 1.\n`
    )
  })

  it('says when the trash is empty', async () => {
    const h = harness(() => Response.json({ items: [], total: 0 }))
    await h.run('trash', [])
    expect(h.written()).toBe('The trash is empty.\n')
  })
})
