import { z } from 'zod'
import type { TelerApiClient } from './api'
import { readTaskAcceptance, resolveCliOrganizationId, watchTask, type Output } from './chats'

const chatIdSchema = z.string().regex(/^chat_[0-9a-hjkmnp-tv-z]{26}$/)
const messageIdSchema = z.string().regex(/^msg_[0-9a-hjkmnp-tv-z]{26}$/)
const approvalSchema = z
  .object({
    type: z.literal('web_approval'),
    approvalId: z.string().min(1),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    input: z.unknown().optional(),
    signature: z.string().optional(),
    approved: z.boolean().optional(),
    consumedAt: z.string().optional(),
  })
  .passthrough()
const messageSchema = z.object({
  id: messageIdSchema,
  role: z.enum(['user', 'assistant']),
  content: z.array(z.unknown()),
})
const approvalChatSchema = z.object({
  id: chatIdSchema,
  messages: z.array(messageSchema),
})

function textFromUserContent(content: unknown[]): string {
  return content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return []
      const candidate = part as Record<string, unknown>
      return candidate.type === 'text' && typeof candidate.text === 'string' ? [candidate.text] : []
    })
    .join('\n')
}

export async function respondToApproval(
  client: TelerApiClient,
  output: Output,
  options: {
    chatId: string
    approvalId: string
    organizationId?: string
    approved: boolean
    wait: boolean
    signal?: AbortSignal
  }
): Promise<void> {
  const detail = await client.json(`/api/chat/${options.chatId}`, approvalChatSchema, {
    signal: options.signal,
  })
  let approvalMessageIndex = -1
  for (let index = detail.messages.length - 1; index >= 0; index -= 1) {
    const message = detail.messages[index]
    if (
      message?.role === 'assistant' &&
      message.content.some(
        (part) => approvalSchema.safeParse(part).data?.approvalId === options.approvalId
      )
    ) {
      approvalMessageIndex = index
      break
    }
  }
  const approvalMessage = detail.messages[approvalMessageIndex]
  const parsedApproval = approvalMessage?.content
    .map((part) => approvalSchema.safeParse(part))
    .find((parsed) => parsed.success && parsed.data.approvalId === options.approvalId)
  if (!approvalMessage || !parsedApproval?.success) {
    throw new Error('The requested approval was not found in this chat')
  }
  const approval = parsedApproval.data
  if (approval.consumedAt) throw new Error('The requested approval was already resumed')
  if (approval.approved !== undefined && approval.approved !== options.approved) {
    throw new Error('The requested approval already has a different decision')
  }
  let userMessage: (typeof detail.messages)[number] | undefined
  for (let index = approvalMessageIndex - 1; index >= 0; index -= 1) {
    const candidate = detail.messages[index]
    if (candidate?.role === 'user') {
      userMessage = candidate
      break
    }
  }
  if (!userMessage) throw new Error('The approval source turn is unavailable')

  const organizationId = await resolveCliOrganizationId(
    client,
    options.organizationId,
    options.signal
  )
  await client.request(`/api/agent-access/approval/${encodeURIComponent(options.approvalId)}`, {
    method: 'PATCH',
    signal: options.signal,
    body: JSON.stringify({
      organizationId,
      chatId: options.chatId,
      approved: options.approved,
    }),
  })

  const response = await client.request(`/api/chat/${options.chatId}/message`, {
    method: 'POST',
    signal: options.signal,
    body: JSON.stringify({
      messages: [
        {
          id: userMessage.id,
          role: 'user',
          content: textFromUserContent(userMessage.content),
        },
        {
          id: approvalMessage.id,
          role: 'assistant',
          parts: [
            {
              type: `tool-${approval.toolName}`,
              toolCallId: approval.toolCallId,
              state: 'approval-responded',
              input: approval.input,
              approval: {
                id: approval.approvalId,
                approved: options.approved,
                ...(approval.signature ? { signature: approval.signature } : {}),
              },
            },
          ],
        },
      ],
      modelSet: 'lite',
      deepAnalysis: false,
    }),
  })
  const accepted = await readTaskAcceptance(response)
  if (output.json) {
    output.write(
      `${JSON.stringify({
        type: 'approval.responded',
        data: {
          chatId: options.chatId,
          approvalId: options.approvalId,
          approved: options.approved,
          taskId: accepted.taskId,
          messageId: accepted.messageId,
        },
      })}\n`
    )
  } else {
    output.write(
      `Approval ${options.approved ? 'allowed' : 'denied'}; task ${accepted.taskId} accepted for ${options.chatId}.\n`
    )
  }
  if (options.wait) {
    await watchTask(client, output, options.chatId, accepted.taskId, options.signal)
  }
}
