import { z } from 'zod'

/**
 * How an answer reads in a terminal. The app shows each text part of an answer as its own
 * paragraph (the agent's progress notes and the answer are separate parts, with its work between
 * them), and shows `{{source:…}}` markers as source badges. A terminal gets the same paragraphs,
 * no raw markers, and the cited sources once at the end.
 */

export function fieldText(field: unknown): string {
  if (!field || typeof field !== 'object') return ''
  const value = field as Record<string, unknown>
  if (value.type === 'text' && typeof value.text === 'string') return value.text
  if (value.type === 'report' && typeof value.markdown === 'string') return value.markdown
  return ''
}

/** Joins parts as they stream: text after a part without text starts a new paragraph. */
export class AnswerTextJoiner {
  private text = ''
  private broken = false

  /** Adds a part (or a streamed suffix of the last one) and returns the text it adds. */
  add(field: unknown): string {
    const value = fieldText(field)
    if (!value) {
      if (this.text) this.broken = true
      return ''
    }
    let added = value
    if (this.broken) {
      const trailing = /\n*$/.exec(this.text)?.[0].length ?? 0
      added = `${'\n'.repeat(Math.max(0, 2 - trailing))}${value.replace(/^\n+/, '')}`
    }
    this.broken = false
    this.text += added
    return added
  }

  get value(): string {
    return this.text
  }
}

export function joinAnswerText(fields: readonly unknown[]): string {
  const joiner = new AnswerTextJoiner()
  for (const field of fields) joiner.add(field)
  return joiner.value
}

const MARKER = '{{source:'
const MARKER_PATTERN = /[^\S\n]*\{\{source:([^{}]+)\}\}/g

/** Where a marker that is still arriving starts (`{{sou`, `{{source:x}`), or -1. */
function arrivingMarkerStart(text: string): number {
  const start = text.lastIndexOf('{')
  if (start < 0) return -1
  const open = text.lastIndexOf('{{') === start - 1 ? start - 1 : start
  const tail = text.slice(open)
  if (MARKER.startsWith(tail)) return open
  if (tail.startsWith(MARKER) && !tail.includes('}}') && !tail.slice(2).includes('{')) return open
  return -1
}

/**
 * The text to show without its source markers (and the space before each one). While streaming,
 * the end that could still become a marker, or the space before one, waits for the next part, so
 * what is shown is always the start of what the finished answer shows.
 */
export function withoutSourceMarkers(text: string, final: boolean): string {
  let shown = text
  if (!final) {
    const marker = arrivingMarkerStart(shown)
    if (marker >= 0) shown = shown.slice(0, marker)
    shown = shown.replace(/[^\S\n]+$/, '')
  }
  return shown.replace(MARKER_PATTERN, '')
}

const citationsSchema = z.object({
  type: z.literal('source_citations'),
  citations: z.array(z.object({ ref: z.string(), displayName: z.string().optional() })),
})

function plainLine(text: string): string {
  const kept = [...text.replace(/\s+/g, ' ')].filter((char) => {
    const code = char.charCodeAt(0)
    return code >= 32 && (code < 127 || code >= 160)
  })
  return kept.join('').trim()
}

/** The sources the answer's text cites, by the names the app shows, in citation order. */
export function citedSourceNames(text: string, content: readonly unknown[]): string[] {
  const cited = new Set([...text.matchAll(MARKER_PATTERN)].map((match) => match[1]?.trim()))
  const names: string[] = []
  for (const part of content) {
    const parsed = citationsSchema.safeParse(part)
    if (!parsed.success) continue
    for (const citation of parsed.data.citations) {
      // One line of plain text: no control characters that could move the terminal's cursor.
      const name = plainLine(citation.displayName ?? '')
      if (cited.has(citation.ref) && name && !names.includes(name)) names.push(name)
    }
  }
  return names
}
