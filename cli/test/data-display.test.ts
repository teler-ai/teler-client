import { describe, expect, it } from 'bun:test'
import { TelerApiClient } from '../src/api'
import { runDataCommand } from '../src/data-command'
import type { Output } from '../src/chats'

const suffix = '01m2k72d22fqe8ww472ycs3px3'
const organizationId = `org_${suffix}`
const projectId = `prj_${suffix}`

function mockClient(response: unknown) {
  const client = new TelerApiClient(new URL('https://app.teler.ai'), undefined, async () =>
    Response.json(response)
  )
  return client
}

function output(json: boolean) {
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

function expectNoInjectedControls(text: string): void {
  const hasInjectedControls = Array.from(text).some((character) => {
    const codePoint = character.codePointAt(0)
    return (
      codePoint !== undefined &&
      ((codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a) ||
        (codePoint >= 0x7f && codePoint <= 0x9f))
    )
  })
  expect(hasInjectedControls).toBe(false)
}

describe('data discovery human output', () => {
  it('escapes control characters in table list cells and preserves JSON values', async () => {
    const table = {
      id: `tbl_${suffix}\tlabel\u001b[2J\u007f\u0085`,
      ref: 'revenue\nby\rmonth',
      displayName: 'Revenue\tby\nmonth',
      source: 'Monthly\rrevenue\u009b',
      sourceType: 'document',
      scope: 'organization',
      queryable: true,
      ingestStatus: 'ready',
      rowCount: 12,
      columnCount: 2,
    }
    const response = { tables: [table], truncated: false, nextOffset: null }
    const jsonSink = output(true)

    await runDataCommand(
      'data',
      'list',
      ['--org', organizationId, '--project', projectId],
      mockClient(response),
      jsonSink.target
    )

    expect(JSON.parse(jsonSink.text())).toEqual(response)

    const humanSink = output(false)
    await runDataCommand(
      'data',
      'list',
      ['--org', organizationId, '--project', projectId],
      mockClient(response),
      humanSink.target
    )

    expect(humanSink.text()).toBe(
      'ID\tREF\tNAME\tSOURCE\tTYPE\tSCOPE\tQUERYABLE\tROWS\tCOLUMNS\n' +
        `tbl_${suffix}\\x09label\\x1b[2J\\x7f\\x85\trevenue\\x0aby\\x0dmonth\tRevenue\\x09by\\x0amonth\tMonthly\\x0drevenue\\x9b\tdocument\torganization\tyes\t12\t2\n`
    )
    expect(humanSink.text().split('\n')).toHaveLength(3)
    expectNoInjectedControls(humanSink.text())
  })

  it('escapes control characters in table description cells and preserves JSON values', async () => {
    const response = {
      id: `tbl_${suffix}`,
      ref: 'normalized\tref\u0085',
      displayName: 'Monthly\nRevenue\u001b[31m',
      columns: [{ name: 'month\tkey', type: 'date\rtime\u009b', nullable: false }],
      truncated: false,
      nextOffset: null,
    }
    const jsonSink = output(true)

    await runDataCommand(
      'data',
      'describe',
      ['requested_ref', '--org', organizationId, '--project', projectId],
      mockClient(response),
      jsonSink.target
    )

    expect(JSON.parse(jsonSink.text())).toEqual(response)

    const humanSink = output(false)
    await runDataCommand(
      'data',
      'describe',
      ['requested_ref', '--org', organizationId, '--project', projectId],
      mockClient(response),
      humanSink.target
    )

    expect(humanSink.text()).toBe(
      'Table: Monthly\\x0aRevenue\\x1b[31m\tnormalized\\x09ref\\x85\n' +
        'COLUMN\tTYPE\tNULLABLE\n' +
        'month\\x09key\tdate\\x0dtime\\x9b\tno\n'
    )
    expect(humanSink.text().split('\n')).toHaveLength(4)
    expectNoInjectedControls(humanSink.text())
  })

  it('escapes control characters in project list cells and preserves JSON values', async () => {
    const project = {
      id: projectId,
      slug: 'finance',
      name: 'Fin\tance\u001b[31m\u007f\u0085',
      description: 'Finance analyses',
      scope: 'organization',
      isDefault: false,
      isArchived: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-02T00:00:00.000Z',
    }
    const response = { projects: [project] }
    const jsonSink = output(true)

    await runDataCommand(
      'project',
      'list',
      ['--org', organizationId],
      mockClient(response),
      jsonSink.target
    )

    expect(JSON.parse(jsonSink.text())).toEqual(response)

    const humanSink = output(false)
    await runDataCommand(
      'project',
      'list',
      ['--org', organizationId],
      mockClient(response),
      humanSink.target
    )

    expect(humanSink.text()).toBe(`${projectId}\tFin\\x09ance\\x1b[31m\\x7f\\x85\n`)
    expect(humanSink.text().split('\n')).toHaveLength(2)
    expectNoInjectedControls(humanSink.text())
  })
})
