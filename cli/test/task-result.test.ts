import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'
import type { FetchLike } from '../src/api'

const CHAT = 'chat_01m2mgs69ge8nvmkdg6924cgg9'
const TASK = 'atask_01m2mgs69ge8nvmkdg6924cgg9'
const MESSAGE = 'msg_01m2mgs69ge8nvmkdg6924cgg9'
const OTHER = 'msg_01m2mgs69ge8nvmkdg6924cgg8'
const approval = {
  type: 'web_approval',
  approvalId: 'approval-example',
  toolCallId: 'call-example',
  toolName: 'saveMemory',
}

function stream(fields: unknown[] = [], messageId?: string): Response {
  return new Response(
    `event: content\ndata: ${JSON.stringify({ fields, done: false })}\n\n` +
      `event: content\ndata: ${JSON.stringify({ fields: [], done: true, status: 'completed', messageId })}\n\n`
  )
}

function detail(content: unknown[], messageId = MESSAGE): Response {
  return Response.json({
    id: CHAT,
    messages: [
      { id: messageId, role: 'assistant', content },
      { id: OTHER, role: 'assistant', content: [{ type: 'text', text: 'Unrelated turn' }] },
    ],
  })
}

async function run(args: string[], fetch: FetchLike) {
  let stdout = ''
  let stderr = ''
  const code = await main(args, {
    env: { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'example-token' },
    fetch,
    writeOut: (text) => (stdout += text),
    writeErr: (text) => (stderr += text),
  })
  return { code, stdout, stderr }
}

function sendFetch(content: unknown[], streamed: unknown[] = []): FetchLike {
  return async (url) => {
    if (url.endsWith('/message'))
      return Response.json({ taskId: TASK, messageId: MESSAGE }, { status: 202 })
    if (url.endsWith('/stream')) return stream(streamed)
    return detail(content)
  }
}

describe('authoritative task results', () => {
  it('reconciles the accepted message including approval fields before terminal JSON', async () => {
    const content = [{ type: 'text', text: 'Approval needed.' }, approval]
    const result = await run(
      ['send', '--chat', CHAT, '--wait', '--json', 'Remember this'],
      sendFetch(content)
    )
    expect(result.code).toBe(0)
    const events = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(events.at(-2)).toEqual({
      type: 'task.result',
      data: { chatId: CHAT, taskId: TASK, messageId: MESSAGE, content },
    })
    expect(events.at(-1)).toMatchObject({ type: 'task.update', data: { done: true } })
    expect(result.stdout).not.toContain('Unrelated turn')
  })

  it.each([
    [[], 'Final answer.\n'],
    [[{ type: 'text', text: 'Final ' }], 'Final answer.\n'],
    [[{ type: 'text', text: 'Final answer.' }], 'Final answer.\n'],
  ])(
    'prints missing human text without duplicating streamed content (%j)',
    async (fields, expected) => {
      const result = await run(
        ['send', '--chat', CHAT, '--wait', 'Analyze'],
        sendFetch([{ type: 'text', text: 'Final answer.' }], fields)
      )
      expect(result.code).toBe(0)
      expect(result.stdout).toBe(`Task ${TASK} accepted for ${CHAT}.\n${expected}`)
    }
  )

  it('shows a final approval in human output', async () => {
    const result = await run(['send', '--chat', CHAT, '--wait', 'Remember'], sendFetch([approval]))
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(approval.approvalId)
    expect(result.stdout).toContain('approval respond')
  })

  it('reconciles standalone watches using the terminal message identity', async () => {
    const result = await run(['task', 'watch', CHAT, TASK], async (url) =>
      url.endsWith('/stream')
        ? stream([], MESSAGE)
        : detail([{ type: 'report', title: 'Report', markdown: 'Final report.' }])
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('Final report.\n')
  })

  it('preserves inline task acceptance message identity', async () => {
    const result = await run(
      ['send', '--chat', CHAT, '--wait', '--json', 'Analyze'],
      async (url) => {
        if (url.endsWith('/message'))
          return new Response(
            `data: ${JSON.stringify({ type: 'data-agent-task', data: { taskId: TASK, messageId: MESSAGE } })}\n\ndata: [DONE]\n\n`
          )
        if (url.endsWith('/stream')) return stream()
        return detail([{ type: 'text', text: 'Inline result.' }])
      }
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Inline result.')
  })

  it('never fetches final content for metadata-only output', async () => {
    const paths: string[] = []
    const result = await run(
      ['task', 'watch', CHAT, TASK, '--json', '--metadata-only'],
      async (url) => {
        paths.push(new URL(url).pathname)
        return stream([{ type: 'text', text: 'Private content' }], MESSAGE)
      }
    )
    expect(result.code).toBe(0)
    expect(paths).toEqual([`/api/chat/${CHAT}/task/${TASK}/stream`])
    expect(result.stdout).not.toContain('Private')
    expect(result.stdout).not.toContain('task.result')
  })

  it('fails without declaring completion if the accepted message is missing', async () => {
    const result = await run(
      ['send', '--chat', CHAT, '--wait', '--json', 'Analyze'],
      async (url) => {
        if (url.endsWith('/message'))
          return Response.json({ taskId: TASK, messageId: MESSAGE }, { status: 202 })
        if (url.endsWith('/stream')) return stream()
        return detail([{ type: 'text', text: 'Unrelated content' }], OTHER)
      }
    )
    expect(result.code).toBe(1)
    expect(result.stdout).not.toContain('"done":true')
    expect(result.stdout).not.toContain('Unrelated content')
  })

  it('applies the watch timeout to final reconciliation', async () => {
    const result = await run(
      ['send', '--chat', CHAT, '--wait', '--json', '--timeout', '0.01', 'Analyze'],
      async (url, init) => {
        if (url.endsWith('/message'))
          return Response.json({ taskId: TASK, messageId: MESSAGE }, { status: 202 })
        if (url.endsWith('/stream')) return stream()
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('private error')))
        })
      }
    )
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stderr).error.code).toBe('TIMEOUT')
    expect(result.stdout).not.toContain('"done":true')
    expect(result.stderr).not.toContain('private error')
  })

  it('preserves terminal fields from older servers without message identity', async () => {
    const result = await run(
      ['task', 'watch', CHAT, TASK],
      async () =>
        new Response(
          'event: content\ndata: {"fields":[{"type":"text","text":"Legacy answer."}],"done":true,"status":"completed"}\n\n'
        )
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('Legacy answer.\n')
  })

  it('does not repeat inline text replayed by the task stream', async () => {
    const result = await run(['send', '--chat', CHAT, '--wait', 'Analyze'], async (url) => {
      if (url.endsWith('/message'))
        return new Response(
          'data: {"type":"text-delta","delta":"Hello "}\n\n' +
            `data: ${JSON.stringify({ type: 'data-agent-task', data: { taskId: TASK, messageId: MESSAGE } })}\n\ndata: [DONE]\n\n`
        )
      if (url.endsWith('/stream')) return stream([{ type: 'text', text: 'Hello world.' }])
      return detail([{ type: 'text', text: 'Hello world.' }])
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('Hello world.\n')
  })

  it.each(['failed', 'cancelled'])(
    'does not fetch or publish a successful result for %s tasks',
    async (status) => {
      let requests = 0
      const result = await run(['task', 'watch', CHAT, TASK, '--json'], async () => {
        requests += 1
        return new Response(
          `event: content\ndata: ${JSON.stringify({ fields: [], done: true, status, messageId: MESSAGE, error: 'private provider failure' })}\n\n`
        )
      })
      expect(result.code).toBe(1)
      expect(requests).toBe(1)
      expect(result.stdout).not.toContain('task.result')
      expect(result.stdout + result.stderr).not.toContain('private provider failure')
    }
  )

  it('labels a final projection that replaces streamed text', async () => {
    const result = await run(
      ['send', '--chat', CHAT, '--wait', 'Analyze'],
      sendFetch(
        [{ type: 'text', text: 'Revised answer.' }],
        [{ type: 'text', text: 'Preliminary answer.' }]
      )
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Final answer (replaces streamed text):\nRevised answer.')
  })

  it('reconciles the accepted continuation after an approval response', async () => {
    let reads = 0
    const result = await run(
      [
        'approval',
        'respond',
        CHAT,
        approval.approvalId,
        '--allow',
        '--wait',
        '--org',
        'org_example',
        '--json',
      ],
      async (url, init) => {
        if (init?.method === 'PATCH') return Response.json({ approved: true })
        if (url.endsWith('/message'))
          return Response.json({ taskId: TASK, messageId: MESSAGE }, { status: 202 })
        if (url.endsWith('/stream')) return stream()
        reads += 1
        return reads === 1
          ? Response.json({
              id: CHAT,
              messages: [
                { id: OTHER, role: 'user', content: [{ type: 'text', text: 'Remember this' }] },
                { id: MESSAGE, role: 'assistant', content: [approval] },
              ],
            })
          : detail([{ type: 'text', text: 'Memory saved.' }])
      }
    )
    expect(result.code).toBe(0)
    expect(reads).toBe(2)
    expect(result.stdout).toContain('Memory saved.')
    expect(result.stdout).toContain('task.result')
  })
})
