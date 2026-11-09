import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'
import type { FetchLike } from '../src/api'
import { withoutSourceMarkers } from '../src/answer-text'

const CHAT = 'chat_01m2mgs69ge8nvmkdg6924cgg9'
const TASK = 'atask_01m2mgs69ge8nvmkdg6924cgg9'
const MESSAGE = 'msg_01m2mgs69ge8nvmkdg6924cgg9'
const REF = 'organization.quarterly_report_xlsx_revenue_by_region'

const text = (value: string) => ({ type: 'text', text: value })
const step = { type: 'code_execution', status: 'completed' }
const citations = {
  type: 'source_citations',
  citations: [
    {
      ref: REF,
      target: { kind: 'document_table', id: 'example' },
      displayName: 'Revenue by Region',
    },
  ],
}

/** A task that streams one content event per entry of `events`, then finishes with `final`. */
function taskFetch(events: unknown[][], final: unknown[]): FetchLike {
  return async (url) => {
    if (url.endsWith('/stream'))
      return new Response(
        [
          ...events.map((fields) => ({ fields, done: false })),
          { fields: [], done: true, status: 'completed', messageId: MESSAGE },
        ]
          .map((event) => `event: content\ndata: ${JSON.stringify(event)}\n\n`)
          .join('')
      )
    if (url.endsWith('/seen'))
      return Response.json({ chatId: CHAT, lastViewedAt: '2026-01-01T00:00:00.000Z' })
    return Response.json({
      id: CHAT,
      messages: [{ id: MESSAGE, role: 'assistant', content: final }],
    })
  }
}

async function watch(events: unknown[][], final: unknown[]) {
  let stdout = ''
  const code = await main(['task', 'watch', CHAT, TASK], {
    env: { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'example-token' },
    fetch: taskFetch(events, final),
    writeOut: (value) => (stdout += value),
    writeErr: () => undefined,
  })
  return { code, stdout }
}

const ANSWER = `North America had the most revenue, at about $6.08M {{source:${REF}}}.`

describe('an answer in the terminal', () => {
  it('prints a progress note and the answer as separate paragraphs, as the app does', async () => {
    const final = [text("I'm checking the columns."), step, text('North America leads.')]
    const result = await watch(
      [[text("I'm checking the columns.")], [step], [text('North America leads.')]],
      final
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toBe("I'm checking the columns.\n\nNorth America leads.\n")
  })

  it('keeps one text part streamed in pieces together', async () => {
    const result = await watch(
      [[text('North America ')], [text('leads.')]],
      [text('North America leads.')]
    )
    expect(result.stdout).toBe('North America leads.\n')
  })

  it('shows no raw source marker, and names the cited source once at the end', async () => {
    const result = await watch(
      [[text(ANSWER.slice(0, 50))], [text(ANSWER.slice(50, 70))], [text(ANSWER.slice(70))]],
      [text(ANSWER), citations]
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(
      'North America had the most revenue, at about $6.08M.\nFrom: Revenue by Region\n'
    )
  })

  it('names nothing when the answer cites no source', async () => {
    const result = await watch([[text('Done.')]], [text('Done.'), citations])
    expect(result.stdout).toBe('Done.\n')
  })
})

describe('withoutSourceMarkers', () => {
  it('drops each marker and the space before it, keeping the space after', () => {
    expect(
      withoutSourceMarkers(`rose 4% {{source:a}} {{source:b}}, then {{source:c}} fell`, true)
    ).toBe('rose 4%, then fell')
  })

  it('keeps braces that are not a source marker', () => {
    expect(withoutSourceMarkers('Use {{name}} or {x}.', true)).toBe('Use {{name}} or {x}.')
  })

  it('always shows a start of what the finished answer shows while it streams', () => {
    for (let end = 0; end <= ANSWER.length; end++) {
      const shown = withoutSourceMarkers(ANSWER.slice(0, end), false)
      expect(withoutSourceMarkers(ANSWER, true).startsWith(shown)).toBe(true)
      expect(shown).not.toContain('{')
    }
  })
})
