import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'
import type { FetchLike } from '../src/api'
import type { TerminalSize } from '../src/chats'

const CHAT = 'chat_01m2mgs69ge8nvmkdg6924cgg9'
const TASK = 'atask_01m2mgs69ge8nvmkdg6924cgg9'
const MESSAGE = 'msg_01m2mgs69ge8nvmkdg6924cgg9'
const MARKER = '--- The answer below replaces the text above ---\n'

function textField(text: string) {
  return { type: 'text', text }
}

/** A task that streams `streamed` and then finishes with `final` as its answer. */
function taskFetch(streamed: string, final: string): FetchLike {
  return async (url) => {
    if (url.endsWith('/message'))
      return Response.json({ taskId: TASK, messageId: MESSAGE }, { status: 202 })
    if (url.endsWith('/stream'))
      return new Response(
        `event: content\ndata: ${JSON.stringify({ fields: [textField(streamed)], done: false })}\n\n` +
          `event: content\ndata: ${JSON.stringify({ fields: [], done: true, status: 'completed', messageId: MESSAGE })}\n\n`
      )
    if (url.endsWith('/seen'))
      return Response.json({ chatId: CHAT, lastViewedAt: '2026-01-01T00:00:00.000Z' })
    return Response.json({
      id: CHAT,
      messages: [{ id: MESSAGE, role: 'assistant', content: [textField(final)] }],
    })
  }
}

async function watch(streamed: string, final: string, terminal?: TerminalSize, json = false) {
  let stdout = ''
  const code = await main(['task', 'watch', CHAT, TASK, ...(json ? ['--json'] : [])], {
    env: { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'example-token' },
    fetch: taskFetch(streamed, final),
    writeOut: (text) => (stdout += text),
    writeErr: () => undefined,
    terminal: terminal && (() => terminal),
  })
  return { code, stdout }
}

const width = (text: string) => Bun.stringWidth(text)
const screen = { columns: 80, rows: 24, width }

describe('a final answer that replaces the streamed text', () => {
  it('prints a one-line marker and the final answer once when output is not a terminal', async () => {
    const result = await watch('## Sales\nDraft answer.', '## Sales\nRevised answer.')
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(`## Sales\nDraft answer.\n${MARKER}## Sales\nRevised answer.\n`)
  })

  it('erases the streamed text on a terminal and prints only the final answer', async () => {
    const result = await watch('## Sales\nDraft answer.', '## Sales\nRevised answer.', screen)
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('## Sales\nDraft answer.\x1b[1A\r\x1b[J## Sales\nRevised answer.\n')
  })

  it('counts wrapped and wide lines when erasing', async () => {
    const narrow = { columns: 10, rows: 24, width }
    const result = await watch('abcdefghijklmno\n表表表表表表\n', 'Done.', narrow)
    // 15 columns wrap to 2 rows, 12 wide columns to 2 rows, and the cursor sits on a new row.
    expect(result.stdout).toBe('abcdefghijklmno\n表表表表表表\n\x1b[4A\r\x1b[JDone.\n')
  })

  it('counts a wide character that wraps whole to the next row', async () => {
    const narrow = { columns: 5, rows: 24, width }
    // 10 columns, but each wide character that would straddle the margin starts a new row: 3 rows.
    const result = await watch('abcd表表表', 'Done.', narrow)
    expect(result.stdout).toBe('abcd表表表\x1b[2A\r\x1b[JDone.\n')
  })

  it('falls back to the marker for C1 control characters', async () => {
    const result = await watch('a\u009bb', 'Final.', screen)
    expect(result.stdout).toBe(`a\u009bb\n${MARKER}Final.\n`)
  })

  it('falls back to the marker when the streamed text no longer fits on the screen', async () => {
    const tall = Array.from({ length: 30 }, (_, index) => `Line ${index}`).join('\n')
    const result = await watch(tall, 'Short answer.', screen)
    expect(result.stdout).toBe(`${tall}\n${MARKER}Short answer.\n`)
  })

  it('falls back to the marker when the streamed text has characters it cannot measure', async () => {
    const result = await watch('a\tb', 'Final.', screen)
    expect(result.stdout).toBe(`a\tb\n${MARKER}Final.\n`)
  })

  it.each([undefined, screen])(
    'prints unchanged text once, without a marker (%p)',
    async (size) => {
      const result = await watch('Same answer.', 'Same answer.', size)
      expect(result.stdout).toBe('Same answer.\n')
    }
  )

  it('emits one final answer in JSON, with no marker', async () => {
    const result = await watch('Draft answer.', 'Revised answer.', screen, true)
    const lines = result.stdout.trim().split('\n')
    const events = lines.map((line) => JSON.parse(line) as { type: string; data: unknown })
    const results = events.filter((event) => event.type === 'task.result')
    expect(results).toHaveLength(1)
    expect(results[0]?.data).toMatchObject({ content: [textField('Revised answer.')] })
    expect(result.stdout).not.toContain('replaces')
    expect(result.stdout).not.toContain('\x1b')
  })
})
