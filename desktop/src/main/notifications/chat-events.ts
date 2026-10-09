import { z } from 'zod'

/** The fields of the chat list (`GET /api/chat`) the notifications read. */
export const chatListSchema = z.object({
  chats: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      hasActiveTask: z.boolean(),
      // Older chats can have no organization.
      organizationId: z.string().nullable(),
    })
  ),
})

export type ChatInput = z.infer<typeof chatListSchema>['chats'][number]

export interface ChatInfo {
  id: string
  title: string | null
  organizationId: string | null
}

/**
 * Chats that were running at the last look and are not any more: their turn
 * finished. The first look only records what is running.
 */
export function nextChatState(
  previousRunning: Map<string, ChatInfo> | null,
  chats: ChatInput[]
): { running: Map<string, ChatInfo>; finished: ChatInfo[] } {
  const running = new Map<string, ChatInfo>()
  const finished: ChatInfo[] = []
  for (const chat of chats) {
    const info = { id: chat.id, title: chat.title || null, organizationId: chat.organizationId }
    if (chat.hasActiveTask) running.set(chat.id, info)
    else if (previousRunning?.has(chat.id)) finished.push(info)
  }
  return { running, finished }
}
