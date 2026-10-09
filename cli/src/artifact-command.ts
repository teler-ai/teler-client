import { randomUUID } from 'node:crypto'
import { link, open, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { resolveChatId } from './chat-id'
import { assertNoFlags, takeFlag, takeOption } from './command-args'
import { parseControlInput } from './control-args'
import { emitJson } from './command-output'
import { ApiError, UsageError } from './errors'

const suffix = '[0-9a-hjkmnp-tv-z]{26}'
const artifactId = z.string().regex(new RegExp(`^artifact_${suffix}$`))
const chatId = z.string().regex(new RegExp(`^chat_${suffix}$`))
const slug = z
  .string()
  .min(1)
  .max(255)
  // Reject literal control characters in URL path segments.
  // eslint-disable-next-line no-control-regex
  .regex(/^[^/\\?#\u0000-\u001f]+$/)
export const artifactGetInputSchema = z
  .strictObject({
    id: artifactId,
    chatId,
    slug: slug.optional(),
    download: z.boolean().default(false),
    output: z.string().min(1).optional(),
  })
  .refine((value) => value.download === (value.output !== undefined), {
    message: 'Download and output must be specified together.',
  })
export const artifactGetInputJsonSchema = z.toJSONSchema(artifactGetInputSchema, { io: 'input' })
const listSchema = z.object({
  artifacts: z.array(z.object({ id: artifactId, slug })),
  truncated: z.boolean().optional(),
})
const metadataSchema = z.object({
  id: artifactId,
  chatId,
  jobId: z.string().nullable(),
  slug,
  category: z.enum(['chart', 'model', 'file']),
  type: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
  dataSizeBytes: z.number().int().min(0).nullable(),
})

const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024

/** A private temporary file becomes visible atomically; an existing destination is never replaced. */
async function downloadArtifact(
  client: TelerApiClient,
  path: string,
  destination: string
): Promise<string> {
  const target = resolve(destination)
  const temporary = join(dirname(target), `.teler-artifact-${randomUUID()}.part`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let closeStream: (() => Promise<void>) | undefined
  try {
    const response = await client.request(path)
    const length = Number(response.headers.get('Content-Length'))
    if (Number.isFinite(length) && length > MAX_DOWNLOAD_BYTES)
      throw new UsageError('Artifact download exceeds 32 MiB')
    if (!response.body) throw new ApiError('Teler API returned an empty artifact response', 502)
    const reader = response.body.getReader()
    closeStream = async () => {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    handle = await open(temporary, 'wx', 0o600)
    let total = 0
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > MAX_DOWNLOAD_BYTES) throw new UsageError('Artifact download exceeds 32 MiB')
      // FileHandle.write may be partial; write the complete chunk before reading more.
      let offset = 0
      while (offset < part.value.byteLength) {
        const result = await handle.write(part.value, offset, part.value.byteLength - offset)
        if (result.bytesWritten === 0) throw new Error('Incomplete write')
        offset += result.bytesWritten
      }
    }
    await handle.close()
    handle = undefined
    await link(temporary, target)
    return target
  } catch (error) {
    if (error instanceof ApiError || error instanceof UsageError) throw error
    throw new UsageError(
      'Unable to save artifact; choose a writable destination that does not already exist'
    )
  } finally {
    await closeStream?.()
    await handle?.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
  }
}

export async function runArtifactCommand(
  group: string | undefined,
  action: string | undefined,
  args: string[],
  client: TelerApiClient,
  output: Output
): Promise<boolean> {
  if (group !== 'artifact' || action !== 'get') return false
  const chat = takeOption(args, '--chat')
  const requestedSlug = takeOption(args, '--slug')
  const destination = takeOption(args, '--output')
  const download = takeFlag(args, '--download')
  assertNoFlags(args)
  if (args.length !== 1 || !chat)
    throw new UsageError(
      'Usage: teler artifact get <id> --chat <id> [--slug <slug>] [--download --output <file>]'
    )
  const input = parseControlInput(
    artifactGetInputSchema,
    {
      id: args[0],
      chatId: resolveChatId(chat),
      slug: requestedSlug,
      download,
      output: destination,
    },
    'artifact options'
  )
  const base = `/api/chat/${input.chatId}/artifact`
  let selectedSlug = input.slug
  if (!selectedSlug) {
    const list = await client.json(base, listSchema)
    selectedSlug = list.artifacts.find((item) => item.id === input.id)?.slug
    if (!selectedSlug) {
      if (list.truncated)
        throw new UsageError('Artifact list is truncated; supply --slug from the run receipt')
      throw new ApiError('Artifact is unavailable in this chat', 404, 'NOT_FOUND')
    }
  }
  const path = `${base}/${encodeURIComponent(selectedSlug)}`
  const metadata = await client.json(path, metadataSchema)
  if (
    metadata.id !== input.id ||
    metadata.chatId !== input.chatId ||
    metadata.slug !== selectedSlug
  )
    throw new ApiError('Teler API returned mismatched artifact metadata', 502)
  const downloadedTo = input.download
    ? await downloadArtifact(client, `${path}/data`, input.output!)
    : undefined
  if (output.json) emitJson(output, { ...metadata, ...(downloadedTo ? { downloadedTo } : {}) })
  else {
    output.write(`${metadata.id}\t${metadata.type}\t${metadata.title ?? metadata.slug}\n`)
    if (downloadedTo) output.write(`Saved to ${downloadedTo}\n`)
  }
  return true
}
