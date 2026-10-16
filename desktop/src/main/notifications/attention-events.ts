import {
  AttentionTracker,
  attentionSchema,
  type Attention,
  type AttentionEvent,
} from '@teler-ai/cli/attention'
import type { DesktopActivity } from '../../shared/desktop-api'
import type { ChatFinishedEvent, InboxEvent } from './types'

export { AttentionTracker, attentionSchema, type Attention }

/**
 * Notice types other kinds already announce: a finished handoff is the chat's own notification,
 * and an Agent alert comes through the alert feed with its own copy.
 */
const INBOX_SKIPPED_TYPES = new Set(['handoff_completed', 'agent_alert'])

/** What the tray shows of one attention read. */
export function activityOf(attention: Attention): DesktopActivity {
  const [waitingChat] = attention.waiting.chats
  return {
    runningChats: attention.running.chats.length,
    runningAgents: attention.running.agentRuns.length,
    waitingChats: attention.waiting.chats.length,
    unreadNotifications: attention.unreadNotifications.reduce(
      (total, item) => total + item.count,
      0
    ),
    waitingChat: waitingChat
      ? { id: waitingChat.id, organizationId: waitingChat.organizationId }
      : null,
  }
}

/** The notification events of one read's tracker events: finished chats and new notices. */
export function toNotificationEvents(events: AttentionEvent[]): {
  chats: ChatFinishedEvent[]
  inbox: InboxEvent[]
} {
  const chats: ChatFinishedEvent[] = []
  const inbox: InboxEvent[] = []
  for (const event of events) {
    if (event.type === 'chat.finished')
      chats.push({
        kind: 'chat-finished',
        id: event.data.id,
        title: event.data.title || null,
        organizationId: event.data.organizationId,
      })
    else if (event.type === 'notification' && !INBOX_SKIPPED_TYPES.has(event.data.type))
      inbox.push({
        kind: 'inbox',
        id: event.data.id,
        organizationId: event.data.organizationId,
        type: event.data.type,
        title: event.data.title,
        body: event.data.body,
        agentLabel: event.data.agentLabel,
        targetPath: event.data.targetPath,
      })
  }
  return { chats, inbox }
}
