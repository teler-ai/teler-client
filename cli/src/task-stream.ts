import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { CommandError } from './errors'
import { readSse } from './sse'
import { messageIdSchema, reconcileTaskResult, taskFieldText } from './task-result'

const taskEventSchema = z
  .object({
    fields: z.array(z.unknown()).optional(),
    done: z.boolean(),
    reconnect: z.boolean().optional(),
    status: z.string().optional(),
    error: z.string().nullable().optional(),
    messageId: messageIdSchema.optional(),
  })
  .passthrough()

interface TaskStreamState {
  lastEventId?: string
  streamedText: string
  inlineTextRemaining: string
}

interface TaskWatchOptions {
  messageId?: string
  streamedText?: string
}

function writeField(output: Output, state: TaskStreamState, field: unknown): void {
  let text = taskFieldText(field)
  if (state.inlineTextRemaining.startsWith(text)) {
    state.inlineTextRemaining = state.inlineTextRemaining.slice(text.length)
    return
  }
  if (text.startsWith(state.inlineTextRemaining))
    text = text.slice(state.inlineTextRemaining.length)
  state.inlineTextRemaining = ''
  output.write(text)
  state.streamedText += text
}

export async function watchTask(
  client: TelerApiClient,
  output: Output,
  chatId: string,
  taskId: string,
  signal?: AbortSignal,
  options: TaskWatchOptions = {}
): Promise<void> {
  const state: TaskStreamState = {
    streamedText: options.streamedText ?? '',
    inlineTextRemaining: options.streamedText ?? '',
  }
  for (;;) {
    const response = await client.request(`/api/chat/${chatId}/task/${taskId}/stream`, {
      headers: state.lastEventId ? { 'Last-Event-ID': state.lastEventId } : undefined,
      signal,
    })
    if (!response.body) throw new Error('Teler task stream returned no content')
    let reconnect = false
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
      const failed =
        event.status === 'failed' || event.status === 'cancelled' || Boolean(event.error)
      let wroteContent = state.streamedText.length > 0
      let reconciled = false
      if (event.done && !failed && !output.metadataOnly) {
        if (options.messageId && event.messageId && options.messageId !== event.messageId) {
          throw new CommandError('INVALID_RESPONSE', 'Teler task returned a different message')
        }
        const messageId = options.messageId ?? event.messageId
        if (messageId) {
          wroteContent = await reconcileTaskResult(
            client,
            output,
            chatId,
            taskId,
            messageId,
            state.streamedText,
            signal
          )
          reconciled = true
        }
      }
      if (output.json) {
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
        output.write(`${JSON.stringify({ type: 'task.update', data })}\n`)
      } else if (!output.metadataOnly && !reconciled) {
        for (const field of event.fields ?? []) writeField(output, state, field)
        wroteContent = state.streamedText.length > 0
      }
      if (failed) throw new Error('Teler task failed')
      if (event.done) {
        if (!output.json) output.write(wroteContent ? '\n' : 'Task completed.\n')
        return
      }
      if (event.reconnect) {
        reconnect = true
        break
      }
    }
    if (!reconnect) throw new Error('Teler task stream ended before completion')
  }
}
