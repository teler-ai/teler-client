import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { emitJson, pathGlob, resolveOrganizationId } from './command-output'
import { fileDiscoveryTreeSchema, formatFileDiscoveryTree } from './file-discovery'

const scopeSchema = z.enum(['organization', 'personal'])
const readFileEntrySchema = z
  .object({
    kind: z.string(),
    type: z.string(),
    path: z.string(),
    scope: scopeSchema,
    name: z.string().optional(),
    language: z.string().nullable().optional(),
    size_bytes: z.number().nullable().optional(),
    page_count: z.number().nullable().optional(),
    text: z.string().optional(),
  })
  .passthrough()
const errorEntrySchema = z.object({
  type: z.literal('error'),
  path: z.string(),
  reason: z.string(),
})
const readSchema = z.object({
  items: z.array(z.union([readFileEntrySchema, errorEntrySchema])),
})
const searchSchema = z.object({
  items: z.array(
    z.object({
      path: z.string(),
      kind: z.string(),
      snippet: z.string(),
      score: z.number(),
      scope: scopeSchema.optional(),
    })
  ),
})
const writeSchema = z.object({ path: z.string(), type: z.string() }).passthrough()
const mkdirSchema = z.object({ path: z.string(), type: z.literal('folder'), scope: scopeSchema })
const mutationSchema = z.object({ from: z.string(), to: z.string() })

interface OrganizationOption {
  organizationId?: string
  signal?: AbortSignal
}

export interface ListFilesOptions extends OrganizationOption {
  path?: string
  query?: string
  kind?: string
  scope?: 'organization' | 'personal' | 'organization,personal'
  limit?: number
  offset?: number
}

export async function listFiles(
  client: TelerApiClient,
  output: Output,
  options: ListFilesOptions
): Promise<void> {
  const organizationId = await resolveOrganizationId(client, options.organizationId, options.signal)
  const query = new URLSearchParams({
    organizationId,
    path: options.path ?? '/',
    limit: String(options.limit ?? 100),
    offset: String(options.offset ?? 0),
  })
  if (options.query) query.set('query', options.query)
  if (options.kind) query.set('kind', options.kind)
  if (options.scope) query.set('scope', options.scope)
  const result = await client.json(`/api/files/tree?${query}`, fileDiscoveryTreeSchema, {
    signal: options.signal,
  })
  if (output.json) return emitJson(output, result)
  if (result.children.length === 0) {
    return output.write(
      result.truncated ? 'Files omitted; increase --limit or use --offset.\n' : 'No files found.\n'
    )
  }
  for (const line of formatFileDiscoveryTree(result)) output.write(`${line}\n`)
}

export async function readFiles(
  client: TelerApiClient,
  output: Output,
  options: OrganizationOption & { paths: string[] }
): Promise<void> {
  const organizationId = await resolveOrganizationId(client, options.organizationId, options.signal)
  const result = await client.json('/api/files/read', readSchema, {
    method: 'POST',
    body: JSON.stringify({ organizationId, paths: options.paths }),
    signal: options.signal,
  })
  if (output.json) return emitJson(output, result)
  for (const item of result.items) {
    if ('reason' in item) output.write(`${item.path}: ${item.reason}\n`)
    else output.write(`${item.path}\n${item.text ?? '(no text content)'}\n`)
  }
}

export interface SearchFilesOptions extends OrganizationOption {
  query: string
  path?: string
  scope?: 'organization' | 'personal' | 'organization,personal'
  limit?: number
}

export async function searchFiles(
  client: TelerApiClient,
  output: Output,
  options: SearchFilesOptions
): Promise<void> {
  const organizationId = await resolveOrganizationId(client, options.organizationId, options.signal)
  const scope = options.scope?.split(',')
  const result = await client.json('/api/files/search', searchSchema, {
    method: 'POST',
    body: JSON.stringify({
      organizationId,
      query: options.query,
      glob: pathGlob(options.path, true),
      ...(scope ? { scope } : {}),
      limit: options.limit ?? 10,
    }),
    signal: options.signal,
  })
  if (output.json) return emitJson(output, result)
  if (result.items.length === 0) return output.write('No matches found.\n')
  for (const item of result.items) output.write(`${item.path}\t${item.score}\t${item.snippet}\n`)
}

interface WriteOptions extends OrganizationOption {
  path: string
  content: string
}

export async function writeFile(
  client: TelerApiClient,
  output: Output,
  options: WriteOptions
): Promise<void> {
  const organizationId = await resolveOrganizationId(client, options.organizationId, options.signal)
  const result = await client.json('/api/files', writeSchema, {
    method: 'POST',
    body: JSON.stringify({ organizationId, path: options.path, content: options.content }),
    signal: options.signal,
  })
  emitMutation(output, result, `Wrote ${result.path}.`)
}

export async function mkdir(
  client: TelerApiClient,
  output: Output,
  options: OrganizationOption & { path: string }
): Promise<void> {
  const organizationId = await resolveOrganizationId(client, options.organizationId, options.signal)
  const result = await client.json('/api/files/mkdir', mkdirSchema, {
    method: 'POST',
    body: JSON.stringify({ organizationId, path: options.path }),
    signal: options.signal,
  })
  emitMutation(output, result, `Created ${result.path}.`)
}

async function relocate(
  client: TelerApiClient,
  output: Output,
  action: 'move' | 'copy',
  options: OrganizationOption & { from: string; to: string }
): Promise<void> {
  const organizationId = await resolveOrganizationId(client, options.organizationId, options.signal)
  const result = await client.json(`/api/files/${action}`, mutationSchema, {
    method: 'POST',
    body: JSON.stringify({ organizationId, from: options.from, to: options.to }),
    signal: options.signal,
  })
  emitMutation(
    output,
    result,
    `${action === 'move' ? 'Moved' : 'Copied'} ${result.from} to ${result.to}.`
  )
}

export const moveFile = (
  client: TelerApiClient,
  output: Output,
  options: OrganizationOption & { from: string; to: string }
) => relocate(client, output, 'move', options)

export const copyFile = (
  client: TelerApiClient,
  output: Output,
  options: OrganizationOption & { from: string; to: string }
) => relocate(client, output, 'copy', options)

function emitMutation(output: Output, result: unknown, message: string): void {
  if (output.json) emitJson(output, result)
  else output.write(`${message}\n`)
}
