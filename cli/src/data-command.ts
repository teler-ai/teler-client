import type { TelerApiClient } from './api'
import { assertNoFlags, parseLimit, takeOption } from './command-args'
import type { Output } from './chats'
import { resolveCliOrganizationId } from './chats'
import { emitJson } from './command-output'
import { parseControlInput } from './control-args'
import {
  dataOrganizationIdSchema,
  dataTablesResponseSchema,
  describeDataTableInputSchema,
  describeDataTableResponseSchema,
  listDataTablesInputSchema,
  listProjectsInputSchema,
  projectListResponseSchema,
} from './data-contract'
import { UsageError } from './errors'

function escapeHumanCell(value: string): string {
  let escaped = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      escaped += `\\x${codePoint.toString(16).padStart(2, '0')}`
    } else {
      escaped += character
    }
  }
  return escaped
}

function parseOffset(raw: string | undefined): number {
  if (raw === undefined) return 0
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new UsageError('--offset must be a non-negative safe integer')
  }
  return value
}

function writePageHint(output: Output, label: string, nextOffset: number | null): void {
  if (nextOffset !== null) {
    output.write(`More ${label} are available; continue with --offset ${nextOffset}.\n`)
  }
}

async function listDataTables(
  args: string[],
  client: TelerApiClient,
  output: Output
): Promise<void> {
  const organizationOption = takeOption(args, '--org')
  const projectId = takeOption(args, '--project')
  const query = takeOption(args, '--query')
  const rawLimit = takeOption(args, '--limit')
  const rawOffset = takeOption(args, '--offset')
  assertNoFlags(args)
  if (args.length !== 0) {
    throw new UsageError(
      'Usage: teler data list --project <id> [--query <text>] [--limit <count>] [--offset <count>] [--org <id>]'
    )
  }

  const input = parseControlInput(
    listDataTablesInputSchema,
    {
      organizationId: organizationOption,
      projectId,
      query,
      limit: parseLimit(rawLimit, 50, 100),
      offset: parseOffset(rawOffset),
    },
    'data table list options'
  )
  const organizationId = parseControlInput(
    dataOrganizationIdSchema,
    await resolveCliOrganizationId(client, input.organizationId),
    'organization ID'
  )
  const search = new URLSearchParams({
    organizationId,
    projectId: input.projectId,
    ...(input.query ? { query: input.query } : {}),
    limit: String(input.limit),
    offset: String(input.offset),
  })
  const result = await client.json(`/api/data/tables?${search}`, dataTablesResponseSchema)

  if (output.json) {
    emitJson(output, result)
    return
  }
  if (result.tables.length === 0) {
    output.write('No data tables found.\n')
    writePageHint(output, 'tables', result.nextOffset)
    return
  }
  output.write('ID\tREF\tNAME\tSOURCE\tTYPE\tSCOPE\tQUERYABLE\tROWS\tCOLUMNS\n')
  for (const table of result.tables) {
    const queryable = table.queryable ? 'yes' : `no (${table.unavailableReason ?? 'unavailable'})`
    output.write(
      [
        escapeHumanCell(table.id),
        escapeHumanCell(table.ref ?? '-'),
        escapeHumanCell(table.displayName),
        escapeHumanCell(table.source),
        escapeHumanCell(table.sourceType),
        escapeHumanCell(table.scope),
        escapeHumanCell(queryable),
        table.rowCount ?? '-',
        table.columnCount ?? '-',
      ].join('\t') + '\n'
    )
  }
  writePageHint(output, 'tables', result.nextOffset)
}

async function describeDataTable(
  args: string[],
  client: TelerApiClient,
  output: Output
): Promise<void> {
  const organizationOption = takeOption(args, '--org')
  const projectId = takeOption(args, '--project')
  const rawLimit = takeOption(args, '--limit')
  const rawOffset = takeOption(args, '--offset')
  assertNoFlags(args)
  if (args.length !== 1) {
    throw new UsageError(
      'Usage: teler data describe <ref> --project <id> [--limit <count>] [--offset <count>] [--org <id>]'
    )
  }

  const input = parseControlInput(
    describeDataTableInputSchema,
    {
      organizationId: organizationOption,
      projectId,
      ref: args[0],
      limit: parseLimit(rawLimit, 100, 500),
      offset: parseOffset(rawOffset),
    },
    'data table describe options'
  )
  const organizationId = parseControlInput(
    dataOrganizationIdSchema,
    await resolveCliOrganizationId(client, input.organizationId),
    'organization ID'
  )
  const search = new URLSearchParams({
    organizationId,
    projectId: input.projectId,
    ref: input.ref,
    limit: String(input.limit),
    offset: String(input.offset),
  })
  const result = await client.json(`/api/data/describe?${search}`, describeDataTableResponseSchema)

  if (output.json) {
    emitJson(output, result)
    return
  }
  output.write(`Table: ${escapeHumanCell(result.displayName)}\t${escapeHumanCell(result.ref)}\n`)
  output.write('COLUMN\tTYPE\tNULLABLE\n')
  for (const column of result.columns) {
    output.write(
      `${escapeHumanCell(column.name)}\t${escapeHumanCell(column.type ?? '-')}\t${column.nullable === undefined ? '-' : column.nullable ? 'yes' : 'no'}\n`
    )
  }
  writePageHint(output, 'columns', result.nextOffset)
}

async function listProjects(args: string[], client: TelerApiClient, output: Output): Promise<void> {
  const organizationOption = takeOption(args, '--org')
  assertNoFlags(args)
  if (args.length !== 0) {
    throw new UsageError('Usage: teler project list [--org <id>]')
  }
  const input = parseControlInput(
    listProjectsInputSchema,
    { organizationId: organizationOption },
    'project list options'
  )
  const organizationId = parseControlInput(
    dataOrganizationIdSchema,
    await resolveCliOrganizationId(client, input.organizationId),
    'organization ID'
  )
  const search = new URLSearchParams({ organizationId })
  const result = await client.json(`/api/projects?${search}`, projectListResponseSchema)

  if (output.json) {
    emitJson(output, result)
    return
  }
  if (result.projects.length === 0) return output.write('No projects found.\n')
  for (const project of result.projects) {
    output.write(`${escapeHumanCell(project.id)}\t${escapeHumanCell(project.name)}\n`)
  }
}

export async function runDataCommand(
  group: string | undefined,
  action: string | undefined,
  args: string[],
  client: TelerApiClient,
  output: Output
): Promise<boolean> {
  if (group === 'data') {
    if (action === 'list') await listDataTables(args, client, output)
    else if (action === 'describe') await describeDataTable(args, client, output)
    else throw new UsageError('Unknown data command. Use list or describe.')
    return true
  }
  if (group === 'project') {
    if (action !== 'list') throw new UsageError('Unknown project command. Use list.')
    await listProjects(args, client, output)
    return true
  }
  return false
}
