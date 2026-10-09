import { UsageError } from './errors'

const CHAT_ID = /^chat_[0-9a-hjkmnp-tv-z]{26}$/
const TASK_ID = /^atask_[0-9a-hjkmnp-tv-z]{26}$/

export function resolveChatId(value: string): string {
  if (CHAT_ID.test(value)) return value
  try {
    const segments = new URL(value).pathname.split('/').filter(Boolean)
    const chatIndex = segments.lastIndexOf('chat')
    const candidate = chatIndex >= 0 ? segments[chatIndex + 1] : undefined
    if (candidate && CHAT_ID.test(candidate)) return candidate
  } catch {
    // Fall through to one stable usage error.
  }
  throw new UsageError('Expected a Teler chat ID or chat URL')
}

export function resolveTaskId(value: string): string {
  if (TASK_ID.test(value)) return value
  throw new UsageError('Expected a Teler agent task ID')
}
