import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'
import type { FetchLike } from '../src/api'

const CHAT = 'chat_01m2mgs69ge8nvmkdg6924cgg9'
const OTHER_CHAT = 'chat_01m2mgs69ge8nvmkdg6924cgg8'
const TASK = 'atask_01m2mgs69ge8nvmkdg6924cgg9'
const MESSAGE = 'msg_01m2mgs69ge8nvmkdg6924cgg9'
const content = [{ type: 'text', text: 'The older task result.' }]
const recentMessages = Array.from({ length: 200 }, (_, index) => ({
  id: `msg_${String(index).padStart(26, '0')}`,
  role: 'assistant',
  content: [{ type: 'text', text: 'A newer unrelated turn.' }],
}))

function completedStream(): Response {
  return new Response(
    `event: content\ndata: ${JSON.stringify({ fields: [], done: true, status: 'completed', messageId: MESSAGE })}\n\n`
  )
}

async function watch(json: boolean, fetch: FetchLike, metadataOnly = false) {
  let stdout = ''
  let stderr = ''
  const code = await main(
    [
      'task',
      'watch',
      CHAT,
      TASK,
      ...(json ? ['--json'] : []),
      ...(metadataOnly ? ['--metadata-only'] : []),
    ],
    {
      env: { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'example-token' },
      fetch,
      writeOut: (text) => {
        stdout += text
      },
      writeErr: (text) => {
        stderr += text
      },
    }
  )
  return { code, stdout, stderr }
}

describe('historical task reconciliation', () => {
  it.each([false, true])(
    'reads the exact message outside the newest 200 (JSON: %s)',
    async (json) => {
      const requests: URL[] = []
      const result = await watch(json, async (url) => {
        const parsed = new URL(url)
        requests.push(parsed)
        if (parsed.pathname.endsWith('/stream')) return completedStream()
        return Response.json({
          id: CHAT,
          messages:
            parsed.searchParams.get('messageId') === MESSAGE
              ? [{ id: MESSAGE, role: 'assistant', content }]
              : recentMessages,
        })
      })
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expect(requests).toHaveLength(2)
      expect(requests[1]?.pathname).toBe(`/api/chat/${CHAT}`)
      expect(Object.fromEntries(requests[1]!.searchParams)).toEqual({ messageId: MESSAGE })
      if (json) {
        const events = result.stdout
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        expect(events[0]).toEqual({
          type: 'task.result',
          data: { chatId: CHAT, taskId: TASK, messageId: MESSAGE, content },
        })
        expect(events[1]).toMatchObject({
          type: 'task.update',
          data: { done: true, status: 'completed' },
        })
      } else expect(result.stdout).toBe('The older task result.\n')
      expect(result.stdout).not.toContain('unrelated')
    }
  )

  it.each(['chat', 'message'])('refuses a filtered response for the wrong %s', async (mismatch) => {
    const result = await watch(true, async (url) => {
      if (new URL(url).pathname.endsWith('/stream')) return completedStream()
      return Response.json({
        id: mismatch === 'chat' ? OTHER_CHAT : CHAT,
        messages: [
          {
            id: mismatch === 'message' ? recentMessages[0]!.id : MESSAGE,
            role: 'assistant',
            content: [{ type: 'text', text: 'Foreign content.' }],
          },
        ],
      })
    })
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(JSON.parse(result.stderr).error.code).toBe('INVALID_RESPONSE')
    expect(result.stderr).not.toContain('Foreign content')
  })

  it('does not read historical content in metadata-only mode', async () => {
    const requests: string[] = []
    const result = await watch(
      true,
      async (url) => {
        requests.push(new URL(url).pathname)
        return completedStream()
      },
      true
    )
    expect(result.code).toBe(0)
    expect(requests).toEqual([`/api/chat/${CHAT}/task/${TASK}/stream`])
    expect(result.stdout).not.toContain('task.result')
    expect(result.stdout).not.toContain(MESSAGE)
  })
})
