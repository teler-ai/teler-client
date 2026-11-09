import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output, TerminalSize } from './chats'
import { citedSourceNames, joinAnswerText, withoutSourceMarkers } from './answer-text'
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

const REPLACED_MARKER = '--- The answer below replaces the text above ---\n'

/** Tabs, carriage returns, escape sequences and C1 controls move the cursor in ways rows can't be counted for. */
function moves(text: string): boolean {
  return [...text].some((char) => {
    const code = char.charCodeAt(0)
    return (code < 32 && char !== '\n') || (code >= 127 && code < 160)
  })
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The rows one line takes: a wide character that would straddle the margin wraps whole. */
function lineRows(line: string, terminal: TerminalSize): number {
  let rows = 1
  let column = 0
  for (const { segment } of graphemes.segment(line)) {
    const width = terminal.width(segment)
    if (column + width > terminal.columns) {
      rows += 1
      column = 0
    }
    column += width
  }
  return rows
}

/**
 * What to print before a final answer that replaces the streamed text. On a terminal that still
 * shows all of the streamed text, erase it; elsewhere it stays, so a one-line marker says the
 * answer below replaces it.
 */
function replacementPrefix(streamedText: string, terminal: TerminalSize | undefined): string {
  const marker = `${streamedText.endsWith('\n') ? '' : '\n'}${REPLACED_MARKER}`
  if (!terminal || moves(streamedText)) return marker
  const rows = streamedText.split('\n').reduce((total, line) => total + lineRows(line, terminal), 0)
  if (rows >= terminal.rows) return marker
  return `${rows > 1 ? `\x1b[${rows - 1}A` : ''}\r\x1b[J`
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
  const query = new URLSearchParams({ messageId })
  const detail = await client.json(`/api/chat/${chatId}?${query}`, detailSchema, { signal })
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
  const answer = joinAnswerText(message.content)
  const text = withoutSourceMarkers(answer, true)
  if (text.startsWith(streamedText)) output.write(text.slice(streamedText.length))
  else output.write(`${replacementPrefix(streamedText, output.terminal?.())}${text}`)
  // The app shows the cited sources as badges; the terminal names them once, after the answer.
  const sources = citedSourceNames(answer, message.content)
  if (sources.length) output.write(`${text ? '\n' : ''}From: ${sources.join(', ')}`)

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
  return text.length > 0 || sources.length > 0 || hasApproval
}
