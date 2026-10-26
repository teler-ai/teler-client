import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { codeFileIdSchema } from './code-file-contract'
import { emitJson, resolveOrganizationId } from './command-output'
import { CommandError, UsageError } from './errors'
import { fileDiscoveryTreeSchema } from './file-discovery'

const trashedSchema = z.object({
  deleted: z.number().int(),
  recoverableUntil: z.string().nullable().optional(),
})
const restoredSchema = z.object({ restored: z.number().int() })
const trashSchema = z.object({
  items: z.array(
    z.looseObject({
      id: codeFileIdSchema,
      name: z.string(),
      path: z.string().nullable(),
      scope: z.enum(['organization', 'personal']),
      deletedAt: z.string().nullable(),
      recoverableUntil: z.string().nullable(),
    })
  ),
  total: z.number().int(),
})

interface OrganizationOption {
  organizationId?: string
  signal?: AbortSignal
}

/** A time the server gave, to the minute, in UTC. */
function minute(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** The File a path or a `doc_…` ID names; a folder stays the Teler app's to delete. */
async function fileIdOf(
  client: TelerApiClient,
  target: string,
  options: OrganizationOption
): Promise<string> {
  if (codeFileIdSchema.safeParse(target).success) return target
  if (!target.startsWith('/')) {
    throw new UsageError('Name a File by its path (/personal/… or /organization/…) or its ID')
  }
  const path = target.length > 1 ? target.replace(/\/+$/, '') : target
  const slash = path.lastIndexOf('/')
  const name = path.slice(slash + 1)
  if (!name) throw new UsageError('Name a File by its path or its ID')
  const organizationId = await resolveOrganizationId(client, options.organizationId, options.signal)
  // The parent folder's entries whose path starts with this one; the exact name is picked below.
  const query = new URLSearchParams({
    organizationId,
    path: slash > 0 ? path.slice(0, slash) : '/',
    glob: path,
    limit: '500',
    offset: '0',
  })
  const tree = await client.json(`/api/files/tree?${query}`, fileDiscoveryTreeSchema, {
    signal: options.signal,
  })
  const entry = tree.children.find((child) => child.name === name)
  if (!entry) throw new CommandError('NOT_FOUND', `No File at ${path}`)
  if (entry.kind === 'folder') {
    throw new CommandError('FOLDER_DELETE_IN_APP', 'Folders are deleted in the Teler app')
  }
  const id = entry.documentId ?? entry.fileId
  if (!codeFileIdSchema.safeParse(id).success) {
    throw new CommandError('NOT_FOUND', `No File at ${path}`)
  }
  return id
}

export async function trashFile(
  client: TelerApiClient,
  output: Output,
  options: OrganizationOption & { target: string }
): Promise<void> {
  const id = await fileIdOf(client, options.target, options)
  const result = await client.json(`/api/documents/${id}`, trashedSchema, {
    method: 'DELETE',
    signal: options.signal,
  })
  const recoverableUntil = result.recoverableUntil ?? null
  if (output.json) return emitJson(output, { id, status: 'trashed', recoverableUntil })
  output.write(
    recoverableUntil
      ? `Moved to trash; restore until ${minute(recoverableUntil)} with \`teler files restore ${id}\`.\n`
      : `Moved to trash; restore it with \`teler files restore ${id}\`.\n`
  )
}

export async function restoreFile(
  client: TelerApiClient,
  output: Output,
  options: { id: string; signal?: AbortSignal }
): Promise<void> {
  if (!codeFileIdSchema.safeParse(options.id).success) {
    throw new UsageError('Name the File by its ID, as `teler files trash` shows it')
  }
  const result = await client.json(`/api/documents/${options.id}/restore`, restoredSchema, {
    method: 'POST',
    signal: options.signal,
  })
  if (output.json) return emitJson(output, { id: options.id, status: 'restored', ...result })
  output.write(`Restored ${options.id}.\n`)
}

export async function listTrash(
  client: TelerApiClient,
  output: Output,
  options: OrganizationOption & { limit: number; offset: number }
): Promise<void> {
  const organizationId = await resolveOrganizationId(client, options.organizationId, options.signal)
  const query = new URLSearchParams({
    organizationId,
    deleted: 'true',
    limit: String(options.limit),
    offset: String(options.offset),
  })
  const result = await client.json(`/api/documents?${query}`, trashSchema, {
    signal: options.signal,
  })
  if (output.json) return emitJson(output, result)
  if (result.items.length === 0) return output.write('The trash is empty.\n')
  for (const item of result.items) {
    // The path as `files` commands take it: /personal/… or /organization/….
    const path = `/${item.scope}/${(item.path ?? item.name).replace(/^\/+/, '')}`
    const until = item.recoverableUntil ? `restore until ${minute(item.recoverableUntil)}` : ''
    output.write(`${item.id}  ${path}  ${until}`.trimEnd() + '\n')
  }
  const shown = options.offset + result.items.length
  if (shown < result.total) {
    output.write(`${result.total - shown} more; use --offset ${shown}.\n`)
  }
}
