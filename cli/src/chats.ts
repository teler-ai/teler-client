import { CommandError } from './errors'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { TelerApiClient } from './api'
import { readSse } from './sse'
import { watchTask } from './task-stream'
export { watchTask } from './task-stream'

const chatIdSchema = z.string().regex(/^chat_[0-9a-hjkmnp-tv-z]{26}$/)
const taskIdSchema = z.string().regex(/^atask_[0-9a-hjkmnp-tv-z]{26}$/)
const listSchema = z.object({
  chats: z.array(z.object({ id: chatIdSchema, title: z.string().nullable() }).passthrough()),
  total: z.number(),
  hasMore: z.boolean(),
})
const chatSchema = z.object({ id: chatIdSchema }).passthrough()
const meSchema = z.object({ activeOrganizationId: z.string().nullable() })
const acceptedSchema = z.object({
  taskId: taskIdSchema,
  messageId: z.string().regex(/^msg_[0-9a-hjkmnp-tv-z]{26}$/),
})

export interface Output {
  json: boolean
  metadataOnly: boolean
  write: (text: string) => void
}

export async function readTaskAcceptance(
  response: Response
): Promise<z.infer<typeof acceptedSchema>> {
  if (response.status === 202) {
    const accepted = acceptedSchema.safeParse((await response.json()) as unknown)
    if (accepted.success) return accepted.data
    throw new CommandError('INVALID_RESPONSE', 'Teler API returned an invalid response')
  }
  if (!response.body)
    throw new CommandError('INVALID_RESPONSE', 'Teler API returned an invalid response')
  for await (const event of readSse(response.body)) {
    if (event.kind === 'done') break
    if (!event.value || typeof event.value !== 'object') continue
    const chunk = event.value as Record<string, unknown>
    if (chunk.type !== 'data-agent-task') continue
    const accepted = acceptedSchema.safeParse(chunk.data)
    if (accepted.success) return accepted.data
  }
  throw new CommandError('INVALID_RESPONSE', 'Teler API returned an invalid response')
}

export async function resolveCliOrganizationId(
  client: TelerApiClient,
  organizationId?: string,
  signal?: AbortSignal
): Promise<string> {
  if (organizationId) return organizationId
  const activeOrganizationId = (await client.json('/api/teler-cli/me', meSchema, { signal }))
    .activeOrganizationId
  if (!activeOrganizationId) {
    throw new Error('No active organization; pass --org <organization-id>')
  }
  return activeOrganizationId
}

function emitValue(output: Output, value: unknown): void {
  output.write(`${JSON.stringify(value, null, output.json ? undefined : 2)}\n`)
}

const seenSchema = z.object({ chatId: chatIdSchema, lastViewedAt: z.string() })

/** The person saw the chat's result: its finished turn no longer waits for them anywhere. */
export async function markChatSeen(
  client: TelerApiClient,
  chatId: string,
  signal?: AbortSignal
): Promise<z.infer<typeof seenSchema>> {
  return client.json(`/api/chat/${chatId}/seen`, seenSchema, { method: 'POST', signal })
}

export async function listChats(client: TelerApiClient, output: Output, limit = 20) {
  const result = await client.json(`/api/chat?limit=${limit}&offset=0`, listSchema)
  if (output.json) return emitValue(output, result)
  if (result.chats.length === 0) return output.write('No chats found.\n')
  for (const chat of result.chats) output.write(`${chat.id}\t${chat.title ?? 'Untitled'}\n`)
}

export async function showChat(client: TelerApiClient, output: Output, chatId: string) {
  emitValue(output, await client.json(`/api/chat/${chatId}`, chatSchema))
}

export async function listArtifacts(client: TelerApiClient, output: Output, chatId: string) {
  const response = await client.request(`/api/chat/${chatId}/artifact`)
  emitValue(output, (await response.json()) as unknown)
}

async function streamResponse(response: Response, output: Output) {
  let taskId: string | undefined
  let messageId: string | undefined
  let streamedText = ''
  if (!response.body) return { taskId, messageId, streamedText }
  for await (const event of readSse(response.body)) {
    if (event.kind === 'done') break
    if (!event.value || typeof event.value !== 'object') continue
    const chunk = event.value as Record<string, unknown>
    if (!output.metadataOnly && chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
      if (output.json) emitValue(output, { type: 'turn.delta', data: { delta: chunk.delta } })
      else {
        output.write(chunk.delta)
        streamedText += chunk.delta
      }
    }
    if (chunk.type === 'data-agent-task' && chunk.data && typeof chunk.data === 'object') {
      const candidate = (chunk.data as Record<string, unknown>).taskId
      const parsedTaskId = taskIdSchema.safeParse(candidate)
      if (parsedTaskId.success) {
        taskId = parsedTaskId.data
        messageId = acceptedSchema.safeParse(chunk.data).data?.messageId
      } else if (output.metadataOnly)
        throw new CommandError('INVALID_RESPONSE', 'Teler API returned an invalid task response')
      if (output.json && (!output.metadataOnly || parsedTaskId.success)) {
        emitValue(output, {
          type: 'turn.agent_task',
          data: output.metadataOnly ? { taskId: parsedTaskId.data } : chunk.data,
        })
      }
    }
    if (chunk.type === 'error' && typeof chunk.errorText === 'string') {
      emitValue(output, { type: 'error', data: { message: 'The Teler turn failed' } })
      throw new CommandError('TASK_FAILED', 'The Teler turn failed')
    }
  }
  return { taskId, messageId, streamedText }
}

export async function sendMessage(
  client: TelerApiClient,
  output: Output,
  options: {
    chatId?: string
    newChat: boolean
    organizationId?: string
    title?: string
    message: string
    modelSet?: 'lite' | 'pro'
    wait: boolean
    signal?: AbortSignal
  }
): Promise<void> {
  let chatId = options.chatId
  if (options.newChat) {
    const organizationId = await resolveCliOrganizationId(
      client,
      options.organizationId,
      options.signal
    )
    const created = await client.json('/api/chat', chatSchema, {
      method: 'POST',
      body: JSON.stringify({
        organizationId,
        mindsetName: 'default',
        ...(options.title ? { title: options.title } : {}),
        // Omission preserves the Profile default; an explicit selection freezes the new chat.
        ...(options.modelSet ? { modelSetOverride: options.modelSet } : {}),
      }),
      signal: options.signal,
    })
    chatId = created.id
    if (output.json) emitValue(output, { type: 'chat.created', data: { chatId } })
  }
  if (!chatId) throw new Error('A chat ID is required')

  const response = await client.request(`/api/chat/${chatId}/message`, {
    method: 'POST',
    signal: options.signal,
    body: JSON.stringify({
      messages: [{ id: `cli_${randomUUID()}`, role: 'user', content: options.message }],
      modelSet: options.modelSet ?? 'lite',
    }),
  })
  if (response.status === 202) {
    const acceptedResult = acceptedSchema.safeParse((await response.json()) as unknown)
    if (!acceptedResult.success)
      throw new CommandError('INVALID_RESPONSE', 'Teler API returned an invalid response')
    const accepted = acceptedResult.data
    if (output.json) emitValue(output, { type: 'turn.accepted', data: { chatId, ...accepted } })
    else output.write(`Task ${accepted.taskId} accepted for ${chatId}.\n`)
    if (options.wait) {
      await watchTask(client, output, chatId, accepted.taskId, options.signal, {
        messageId: accepted.messageId,
      })
      await markSeenQuietly(client, output, chatId, options.signal)
    }
    return
  }
  const streamed = await streamResponse(response, output)
  if (options.wait && streamed.taskId) {
    await watchTask(client, output, chatId, streamed.taskId, options.signal, streamed)
    await markSeenQuietly(client, output, chatId, options.signal)
  } else if (!output.json) output.write('\n')
}

/**
 * A watched turn was printed in full: the chat counts as seen. Metadata-only automation saw no
 * content, so it marks nothing. Best effort, never fatal.
 */
export async function markSeenQuietly(
  client: TelerApiClient,
  output: Output,
  chatId: string,
  signal?: AbortSignal
): Promise<void> {
  if (output.metadataOnly) return
  await markChatSeen(client, chatId, signal).catch(() => undefined)
}
