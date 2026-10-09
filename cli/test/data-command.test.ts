import { describe, expect, it } from 'bun:test'
import { TelerApiClient } from '../src/api'
import { runDataCommand } from '../src/data-command'
import type { Output } from '../src/chats'
import { ApiError, UsageError } from '../src/errors'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const organizationId = `org_${suffix}`
const projectId = `prj_${suffix}`
const tableId = `tbl_${suffix}`
const ref = 'revenue_by_month'

function mockClient(responses: unknown[]) {
  const requests: string[] = []
  const client = new TelerApiClient(new URL('https://app.teler.ai'), undefined, async (url) => {
    requests.push(new URL(url).pathname + new URL(url).search)
    return Response.json(responses.shift())
  })
  return { client, requests }
}

function output(json = true) {
  let text = ''
  const target: Output = {
    json,
    metadataOnly: false,
    write: (value) => {
      text += value
    },
  }
  return { target, text: () => text }
}

const dataTable = {
  id: tableId,
  ref,
  displayName: 'Revenue by month',
  source: 'Monthly revenue.csv',
  sourceType: 'document',
  scope: 'organization',
  queryable: true,
  ingestStatus: 'ready',
  rowCount: 12,
  columnCount: 2,
}

describe('data discovery commands', () => {
  it('lists bounded project tables with exact filters and pagination metadata', async () => {
    const { client, requests } = mockClient([
      {
        tables: [{ ...dataTable, internalRef: 'private-store-identifier' }],
        truncated: true,
        nextOffset: 15,
      },
    ])
    const sink = output()

    await runDataCommand(
      'data',
      'list',
      [
        '--org',
        organizationId,
        '--project',
        projectId,
        '--query',
        'revenue',
        '--limit',
        '5',
        '--offset',
        '10',
      ],
      client,
      sink.target
    )

    expect(requests).toEqual([
      `/api/data/tables?organizationId=${organizationId}&projectId=${projectId}&query=revenue&limit=5&offset=10`,
    ])
    expect(JSON.parse(sink.text())).toEqual({
      tables: [dataTable],
      truncated: true,
      nextOffset: 15,
    })
    expect(sink.text()).not.toContain('private-store-identifier')
  })

  it('prints a usable next offset in human output and ignores unrelated groups', async () => {
    const { client, requests } = mockClient([
      {
        tables: [dataTable],
        truncated: true,
        nextOffset: 1,
      },
    ])
    const sink = output(false)

    expect(await runDataCommand('agent', 'list', [], client, sink.target)).toBe(false)
    expect(requests).toEqual([])
    expect(
      await runDataCommand(
        'data',
        'list',
        ['--org', organizationId, '--project', projectId],
        client,
        sink.target
      )
    ).toBe(true)
    expect(sink.text()).toContain('More tables are available; continue with --offset 1.')
  })

  it('resolves the active organization before listing tables when --org is omitted', async () => {
    const { client, requests } = mockClient([
      { activeOrganizationId: organizationId },
      { tables: [], truncated: false, nextOffset: null },
    ])

    await runDataCommand('data', 'list', ['--project', projectId], client, output().target)

    expect(requests).toEqual([
      '/api/teler-cli/me',
      `/api/data/tables?organizationId=${organizationId}&projectId=${projectId}&limit=50&offset=0`,
    ])
  })

  it('describes a table using its ref and preserves the requested result page', async () => {
    const { client, requests } = mockClient([
      {
        id: tableId,
        ref,
        displayName: 'Revenue by month',
        columns: [
          { name: 'month', type: 'date', nullable: false },
          { name: 'revenue', type: 'number', nullable: true },
        ],
        truncated: true,
        nextOffset: 100,
      },
    ])
    const sink = output()

    await runDataCommand(
      'data',
      'describe',
      [ref, '--project', projectId, '--org', organizationId, '--limit', '100', '--offset', '50'],
      client,
      sink.target
    )

    expect(requests).toEqual([
      `/api/data/describe?organizationId=${organizationId}&projectId=${projectId}&ref=${ref}&limit=100&offset=50`,
    ])
    expect(JSON.parse(sink.text())).toEqual({
      id: tableId,
      ref,
      displayName: 'Revenue by month',
      columns: [
        { name: 'month', type: 'date', nullable: false },
        { name: 'revenue', type: 'number', nullable: true },
      ],
      truncated: true,
      nextOffset: 100,
    })
  })

  it('accepts long source metadata within the server response budget', async () => {
    const longRef = 'r'.repeat(600)
    const longDisplayName = 'display-'.repeat(150)
    const longSource = 'source-'.repeat(150)
    const longColumnName = 'column_'.repeat(150)
    const longColumnType = 'type-'.repeat(150)
    const { client, requests } = mockClient([
      {
        tables: [
          {
            id: tableId,
            ref: longRef,
            displayName: longDisplayName,
            source: longSource,
            sourceType: 'document',
            scope: 'organization',
            queryable: true,
          },
        ],
        truncated: false,
        nextOffset: null,
      },
      {
        id: tableId,
        ref: longRef,
        displayName: longDisplayName,
        columns: [{ name: longColumnName, type: longColumnType, nullable: true }],
        truncated: false,
        nextOffset: null,
      },
    ])
    const listSink = output()
    const describeSink = output()

    await runDataCommand(
      'data',
      'list',
      ['--project', projectId, '--org', organizationId],
      client,
      listSink.target
    )

    await runDataCommand(
      'data',
      'describe',
      [longRef, '--project', projectId, '--org', organizationId],
      client,
      describeSink.target
    )

    expect(new URL(requests[1] ?? '', 'https://app.teler.ai').searchParams.get('ref')).toBe(longRef)
    expect(JSON.parse(listSink.text())).toEqual({
      tables: [
        {
          id: tableId,
          ref: longRef,
          displayName: longDisplayName,
          source: longSource,
          sourceType: 'document',
          scope: 'organization',
          queryable: true,
        },
      ],
      truncated: false,
      nextOffset: null,
    })
    expect(JSON.parse(describeSink.text())).toEqual({
      id: tableId,
      ref: longRef,
      displayName: longDisplayName,
      columns: [{ name: longColumnName, type: longColumnType, nullable: true }],
      truncated: false,
      nextOffset: null,
    })
  })

  it('accepts a canonical response ref after the API normalizes the requested ref', async () => {
    const { client } = mockClient([
      {
        id: tableId,
        ref: 'organization.sales',
        displayName: 'Sales',
        columns: [],
        truncated: false,
        nextOffset: null,
      },
    ])

    await expect(
      runDataCommand(
        'data',
        'describe',
        [' ORGANIZATION.SALES ', '--project', projectId, '--org', organizationId],
        client,
        output().target
      )
    ).resolves.toBe(true)
  })

  it('lists projects with full validated JSON fields and concise human output', async () => {
    const project = {
      id: projectId,
      slug: 'finance',
      name: 'Finance',
      description: 'Finance analyses',
      scope: 'organization',
      isDefault: false,
      isArchived: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    }
    const jsonClient = mockClient([{ projects: [project] }])
    const jsonSink = output()

    await runDataCommand(
      'project',
      'list',
      ['--org', organizationId],
      jsonClient.client,
      jsonSink.target
    )

    expect(jsonClient.requests).toEqual([`/api/projects?organizationId=${organizationId}`])
    expect(JSON.parse(jsonSink.text())).toEqual({ projects: [project] })

    const humanClient = mockClient([{ projects: [project] }])
    const humanSink = output(false)
    await runDataCommand(
      'project',
      'list',
      ['--org', organizationId],
      humanClient.client,
      humanSink.target
    )
    expect(humanSink.text()).toBe(`${projectId}\tFinance\n`)
    expect(humanSink.text()).not.toContain('Finance analyses')
  })

  it('rejects malformed options, limits, and positionals before any network request', async () => {
    const invalidCommands = [
      ['data', 'list', []],
      ['data', 'list', ['--project', projectId, '--limit', '0']],
      ['data', 'list', ['--project', projectId, '--limit', '101']],
      ['data', 'list', ['--project', projectId, '--offset', '-1']],
      ['data', 'list', ['--project', projectId, '--offset', '1.5']],
      ['data', 'list', ['--project', projectId, '--unknown', 'value']],
      ['data', 'list', ['--project', projectId, 'unexpected']],
      ['data', 'describe', ['--project', projectId]],
      ['data', 'describe', [ref, '--project', projectId, '--limit', '501']],
      ['data', 'describe', [ref, '--project', projectId, 'unexpected']],
      ['project', 'list', ['unexpected']],
      ['data', 'unknown', []],
    ] as const

    for (const [group, action, args] of invalidCommands) {
      const { client, requests } = mockClient([{ activeOrganizationId: organizationId }])
      await expect(
        runDataCommand(group, action, [...args], client, output().target)
      ).rejects.toBeInstanceOf(UsageError)
      expect(requests).toEqual([])
    }
  })

  it('rejects mismatched server response schemas without emitting data', async () => {
    const { client, requests } = mockClient([
      {
        tables: [{ ...dataTable, sourceType: 'database' }],
        truncated: false,
        nextOffset: null,
      },
    ])
    const sink = output()

    await expect(
      runDataCommand(
        'data',
        'list',
        ['--org', organizationId, '--project', projectId],
        client,
        sink.target
      )
    ).rejects.toBeInstanceOf(ApiError)
    expect(requests).toHaveLength(1)
    expect(sink.text()).toBe('')
  })
})
