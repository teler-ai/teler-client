import { CommandError } from './errors'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { TelerApiClient } from './api'
import { readSse } from './sse'

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
const taskEventSchema = z
  .object({
    fields: z.array(z.unknown()).optional(),
    done: z.boolean(),
    reconnect: z.boolean().optional(),
    status: z.string().optional(),
    error: z.string().nullable().optional(),
    progress: z.unknown().optional(),
    activity: z.unknown().optional(),
    children: z.array(z.unknown()).optional(),
  })
  .passthrough()

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

async function streamResponse(response: Response, output: Output): Promise<string | null> {
  if (!response.body) return null
  let taskId: string | null = null
  for await (const event of readSse(response.body)) {
    if (event.kind === 'done') break
    if (!event.value || typeof event.value !== 'object') continue
    const chunk = event.value as Record<string, unknown>
    if (!output.metadataOnly && chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
      if (output.json) emitValue(output, { type: 'turn.delta', data: { delta: chunk.delta } })
      else output.write(chunk.delta)
    }
    if (chunk.type === 'data-agent-task' && chunk.data && typeof chunk.data === 'object') {
      const candidate = (chunk.data as Record<string, unknown>).taskId
      const parsedTaskId = taskIdSchema.safeParse(candidate)
      if (parsedTaskId.success) taskId = parsedTaskId.data
      else if (output.metadataOnly)
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
  if (!output.json) output.write('\n')
  return taskId
}

interface TaskStreamState {
  lastEventId?: string
  wroteContent: boolean
}

function writeTaskField(output: Output, field: unknown): boolean {
  if (!field || typeof field !== 'object') return false
  const value = field as Record<string, unknown>
  if (value.type === 'text' && typeof value.text === 'string') {
    output.write(value.text)
    return value.text.length > 0
  }
  if (value.type === 'report' && typeof value.markdown === 'string') {
    output.write(value.markdown)
    return value.markdown.length > 0
  }
  return false
}

async function streamTaskResponse(
  response: Response,
  output: Output,
  state: TaskStreamState
): Promise<'done' | 'reconnect'> {
  if (!response.body) throw new Error('Teler task stream returned no content')
  for await (const message of readSse(response.body)) {
    if (message.kind === 'done') break
    if (message.id) state.lastEventId = message.id
    if (message.event && message.event !== 'content') {
      if (message.event === 'error') throw new Error('Teler task failed')
      continue
    }
    const parsed = taskEventSchema.safeParse(message.value)
    if (!parsed.success) continue
    const event = parsed.data
    if (output.json) {
      const failed =
        event.status === 'failed' || event.status === 'cancelled' || Boolean(event.error)
      const safeStatus = ['completed', 'failed', 'cancelled'].includes(event.status ?? '')
        ? event.status
        : undefined
      const data = output.metadataOnly
        ? {
            done: event.done,
            ...(event.reconnect === undefined ? {} : { reconnect: event.reconnect }),
            ...(safeStatus === undefined ? {} : { status: safeStatus }),
            failed,
          }
        : event.error
          ? { ...event, error: 'Teler task failed' }
          : event
      emitValue(output, { type: 'task.update', data })
    } else {
      for (const field of event.fields ?? []) {
        state.wroteContent = writeTaskField(output, field) || state.wroteContent
      }
    }
    if (event.status === 'failed' || event.status === 'cancelled' || event.error) {
      throw new Error('Teler task failed')
    }
    if (event.done) {
      if (!output.json) {
        output.write(state.wroteContent ? '\n' : 'Task completed.\n')
      }
      return 'done'
    }
    if (event.reconnect) return 'reconnect'
  }
  throw new Error('Teler task stream ended before completion')
}

export async function watchTask(
  client: TelerApiClient,
  output: Output,
  chatId: string,
  taskId: string,
  signal?: AbortSignal
) {
  const state: TaskStreamState = { wroteContent: false }
  for (;;) {
    const response = await client.request(`/api/chat/${chatId}/task/${taskId}/stream`, {
      headers: state.lastEventId ? { 'Last-Event-ID': state.lastEventId } : undefined,
      signal,
    })
    if ((await streamTaskResponse(response, output, state)) === 'done') return
  }
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
    modelSet: 'lite' | 'pro'
    deepAnalysis: boolean
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
      modelSet: options.modelSet,
      deepAnalysis: options.deepAnalysis,
    }),
  })
  if (response.status === 202) {
    const acceptedResult = acceptedSchema.safeParse((await response.json()) as unknown)
    if (!acceptedResult.success)
      throw new CommandError('INVALID_RESPONSE', 'Teler API returned an invalid response')
    const accepted = acceptedResult.data
    if (output.json) emitValue(output, { type: 'turn.accepted', data: { chatId, ...accepted } })
    else output.write(`Task ${accepted.taskId} accepted for ${chatId}.\n`)
    if (options.wait) await watchTask(client, output, chatId, accepted.taskId, options.signal)
    return
  }
  const taskId = await streamResponse(response, output)
  if (options.wait && taskId) await watchTask(client, output, chatId, taskId, options.signal)
}
