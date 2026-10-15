import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { CommandError } from './errors'

export const messageIdSchema = z.string().regex(/^msg_[0-9a-hjkmnp-tv-z]{26}$/)
const detailSchema = z.object({
  id: z.string(),
  messages: z.array(
    z.object({
      id: messageIdSchema,
      role: z.string(),
      content: z.array(z.unknown()),
    })
  ),
})

export function taskFieldText(field: unknown): string {
  if (!field || typeof field !== 'object') return ''
  const value = field as Record<string, unknown>
  if (value.type === 'text' && typeof value.text === 'string') return value.text
  if (value.type === 'report' && typeof value.markdown === 'string') return value.markdown
  return ''
}

export async function reconcileTaskResult(
  client: TelerApiClient,
  output: Output,
  chatId: string,
  taskId: string,
  messageId: string,
  streamedText: string,
  signal?: AbortSignal
): Promise<boolean> {
  const detail = await client.json(`/api/chat/${chatId}`, detailSchema, { signal })
  const message = detail.messages.find(
    (candidate) => candidate.id === messageId && candidate.role === 'assistant'
  )
  if (detail.id !== chatId || !message) {
    throw new CommandError('INVALID_RESPONSE', 'The final task message is unavailable')
  }
  if (output.json) {
    output.write(
      `${JSON.stringify({ type: 'task.result', data: { chatId, taskId, messageId, content: message.content } })}\n`
    )
    return false
  }
  const text = message.content.map(taskFieldText).join('')
  if (text.startsWith(streamedText)) output.write(text.slice(streamedText.length))
  else output.write(`\nFinal answer (replaces streamed text):\n${text}`)

  let hasApproval = false
  for (const part of message.content) {
    if (!part || typeof part !== 'object') continue
    const field = part as Record<string, unknown>
    if (
      field.type !== 'web_approval' ||
      typeof field.approvalId !== 'string' ||
      field.approved !== undefined ||
      field.consumedAt
    )
      continue
    output.write(
      `\nApproval required: ${JSON.stringify(field.approvalId)}. Run teler approval respond ${chatId} ${JSON.stringify(field.approvalId)} --allow or --deny.\n`
    )
    hasApproval = true
  }
  return text.length > 0 || hasApproval
}
