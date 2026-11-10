import type { LinkContent } from './protocol'

/** A tool's input or output longer than this is cut in the replayed conversation. */
const MAX_REPLAYED_CHARS = 20_000

type Item = Record<string, unknown>

function record(value: unknown): Item | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Item) : null
}

function cut(text: string): string {
  return text.length <= MAX_REPLAYED_CHARS
    ? text
    : `${text.slice(0, MAX_REPLAYED_CHARS)}\n[… ${text.length - MAX_REPLAYED_CHARS} more characters not shown]`
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      const value = record(part)
      if (typeof value?.text === 'string') return value.text
      if (value?.type === 'input_image') return '[image]'
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function outputText(output: unknown): string {
  if (typeof output === 'string') return output
  return messageText(output)
}

/** One earlier item of the chat as a labelled block, or null for an item without content. */
function block(item: Item): string | null {
  if (item.type === 'message') {
    const text = messageText(item.content).trim()
    if (!text) return null
    const label = item.role === 'user' ? 'member' : item.role === 'assistant' ? 'you' : 'teler note'
    return `[${label}]\n${text}`
  }
  if (item.type === 'function_call' && typeof item.name === 'string') {
    const args =
      typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments)
    return `[you called ${item.name}]\n${cut(args ?? '{}')}`
  }
  if (item.type === 'function_call_output') {
    return `[result]\n${cut(outputText(item.output))}`
  }
  return null
}

/**
 * The chat so far and the member's new message as one prompt. Claude Code starts every turn
 * afresh, so Teler's history (already folded by Teler when it grew long) is replayed here, oldest
 * first; the new message is the last block, so the next turn's prompt begins with this one's.
 */
export function buildClaudePrompt(
  history: readonly unknown[],
  input: LinkContent
): { text: string; images: Array<{ mediaType: string; data: string }> } {
  const blocks = history.flatMap((entry) => {
    const item = record(entry)
    const text = item ? block(item) : null
    return text ? [text] : []
  })
  const images: Array<{ mediaType: string; data: string }> = []
  const current: string[] = []
  for (const part of input) {
    if (part.type === 'text') current.push(part.text)
    else {
      const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(part.url)
      if (match) images.push({ mediaType: match[1] as string, data: match[2] as string })
      else current.push('[an image Teler could not pass on]')
    }
  }
  blocks.push(`[member]\n${current.join('\n').trim()}`)
  const text = [
    '<teler_conversation>',
    'This Teler chat so far, oldest first. Your earlier tool calls ran in Teler; their results are shown as they came back.',
    '',
    blocks.join('\n\n'),
    '</teler_conversation>',
    '',
    "Answer the member's last message.",
  ].join('\n')
  return { text, images }
}
