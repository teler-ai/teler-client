import { describe, expect, test } from 'bun:test'
import { claudeArguments, claudeEnvironment } from '../src/link/claude-turn'
import { ClaudeStreamReader } from '../src/link/claude-stream'
import { detectEngines } from '../src/link/engines'
import { runLinkHelper } from '../src/link/helper'
import type { LinkFrame, LinkUpFrame } from '../src/link/protocol'
import { startToolServer } from '../src/link/tool-server'
import { buildClaudePrompt } from '../src/link/transcript'

function stream(lines: unknown[]): ReadableStream<Uint8Array> {
  const text = lines
    .map((line) => (typeof line === 'string' ? line : JSON.stringify(line)))
    .join('\n')
  return new Response(`${text}\n`).body as ReadableStream<Uint8Array>
}

const event = (value: object) => ({ type: 'stream_event', event: value })

describe('teler link: Claude Code options', () => {
  test('runs print mode with no built-in tools, settings or other MCP servers', () => {
    const args = claudeArguments({
      mcpConfigPath: '/tmp/mcp.json',
      instructionsPath: '/tmp/instructions.md',
      model: 'sonnet',
    })
    expect(args).toContain('--restricted')
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args).toContain('--strict-mcp-config')
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__teler')
    expect(args[args.indexOf('--permission-prompts') + 1]).toBe('none')
    expect(args).toContain('--no-session-persistence')
    expect(args).not.toContain('--bare')
    expect(args).not.toContain('--dangerously-skip-permissions')
    expect(
      claudeArguments({ mcpConfigPath: 'a', instructionsPath: 'b', model: 'opus', effort: 'high' })
    ).toContain('high')
    const env = claudeEnvironment({ HOME: '/home/someone' })
    expect(env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe('false')
    expect(env.HOME).toBe('/home/someone')
  })

  test("reports the engine's own sign-in and plan without reading its credential", async () => {
    const seen: string[][] = []
    const engines = await detectEngines(
      {
        async run(command) {
          seen.push(command)
          if (command[1] === '--version') return { exitCode: 0, stdout: '2.1.317 (Claude Code)\n' }
          return { exitCode: 0, stdout: '{"loggedIn":true,"subscriptionType":"max"}' }
        },
      },
      {}
    )
    expect(engines).toEqual([
      { engine: 'claude_code', version: '2.1.317', signedIn: true, plan: 'max' },
    ])
    expect(seen).toEqual([
      ['claude', '--version'],
      ['claude', 'auth', 'status'],
    ])
    const missing = await detectEngines({ run: async () => ({ exitCode: 127, stdout: '' }) }, {})
    expect(missing).toEqual([])
  })
})

describe('teler link: reading Claude Code', () => {
  test('streams text, then usage and tool calls per response, and the result', async () => {
    const frames: LinkUpFrame[] = []
    const reader = new ClaudeStreamReader({ emit: (frame) => frames.push(frame) })
    await reader.read(
      stream([
        { type: 'system', subtype: 'init', tools: ['mcp__teler__runCode'] },
        event({
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 10,
              cache_creation_input_tokens: 100,
              cache_read_input_tokens: 900,
              output_tokens: 1,
            },
          },
        }),
        event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
        event({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'secret' },
        }),
        event({ type: 'content_block_start', index: 1, content_block: { type: 'text' } }),
        event({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'Checking.' },
        }),
        event({ type: 'content_block_stop', index: 1 }),
        event({
          type: 'content_block_start',
          index: 2,
          content_block: { type: 'tool_use', id: 'toolu_01abc' },
        }),
        event({ type: 'message_delta', usage: { output_tokens: 30 } }),
        event({ type: 'message_stop' }),
        'not json',
        { type: 'result', subtype: 'success', is_error: false, result: 'done' },
      ])
    )
    expect(frames).toEqual([
      { kind: 'text.delta', payload: { itemId: 'msg1_1', delta: 'Checking.' } },
      { kind: 'text.done', payload: { itemId: 'msg1_1' } },
      {
        kind: 'response.done',
        payload: {
          inputTokens: 1_010,
          cachedInputTokens: 900,
          cacheWriteTokens: 100,
          outputTokens: 30,
          toolCalls: 1,
          toolCallIds: ['toolu_01abc'],
        },
      },
    ])
    expect(reader.announcedToolCalls()).toBe(1)
    expect(reader.takeToolCallId()).toBe('toolu_01abc')
    expect(reader.takeToolCallId()).toBeUndefined()
    expect(reader.outcome(false)).toEqual({ status: 'completed' })
    expect(reader.outcome(true)).toEqual({ status: 'interrupted' })
  })

  test('fails a turn that ended without a result, or with a plan limit', async () => {
    const silent = new ClaudeStreamReader({ emit: () => undefined })
    await silent.read(stream([]))
    expect(silent.outcome(false)).toEqual({ status: 'failed', error: 'engine_failed' })
    const limited = new ClaudeStreamReader({ emit: () => undefined })
    await limited.read(
      stream([
        {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          result: 'Usage limit reached',
        },
      ])
    )
    expect(limited.outcome(false)).toEqual({ status: 'failed', error: 'engine_rate_limited' })
  })
})

describe('teler link: the conversation Claude Code reads', () => {
  test("replays the chat oldest first and ends with the member's new message", () => {
    const prompt = buildClaudePrompt(
      [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'First question' }],
        },
        { type: 'function_call', name: 'runCode', arguments: '{"code":"1+1"}', call_id: 'c1' },
        { type: 'function_call_output', call_id: 'c1', output: '2' },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'It is 2.' }],
        },
      ],
      [
        { type: 'text', text: 'And 2+2?' },
        { type: 'image', url: 'data:image/png;base64,iVBORw0KGgo=' },
      ]
    )
    const order = [
      'First question',
      '[you called runCode]',
      '[result]\n2',
      'It is 2.',
      '[member]\nAnd 2+2?',
    ]
    const positions = order.map((part) => prompt.text.indexOf(part))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(prompt.images).toEqual([{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }])
  })

  test("keeps the earlier prompt as the next turn's prefix", () => {
    const first = buildClaudePrompt([], [{ type: 'text', text: 'One' }]).text
    const second = buildClaudePrompt(
      [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'One' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Answer' }] },
      ],
      [{ type: 'text', text: 'Two' }]
    ).text
    const shared = first.slice(0, first.indexOf('One') + 3)
    expect(second.startsWith(shared)).toBe(true)
  })
})

describe("teler link: Teler's tools for Claude Code", () => {
  test('offers exactly the turn tools on loopback and forwards each call', async () => {
    const calls: Array<{ name: string; args: unknown }> = []
    const server = startToolServer(
      [
        {
          name: 'runCode',
          description: 'Run code in Teler',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      async (name, args) => {
        calls.push({ name, args })
        return { isError: false, content: [{ type: 'text', text: 'ran' }] }
      }
    )
    try {
      expect(new URL(server.url).hostname).toBe('127.0.0.1')
      const rpc = (body: object, token = server.token) =>
        fetch(server.url, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', ...body }),
        })
      expect((await rpc({ id: 1, method: 'initialize', params: {} }, 'wrong')).status).toBe(401)
      const init = (await (
        await rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
      ).json()) as {
        result: { protocolVersion: string }
      }
      expect(init.result.protocolVersion).toBe('2025-06-18')
      expect((await rpc({ method: 'notifications/initialized' })).status).toBe(202)
      const list = (await (await rpc({ id: 2, method: 'tools/list' })).json()) as {
        result: { tools: Array<{ name: string }> }
      }
      expect(list.result.tools.map((entry) => entry.name)).toEqual(['runCode'])
      const call = (await (
        await rpc({
          id: 3,
          method: 'tools/call',
          params: { name: 'runCode', arguments: { code: '1' } },
        })
      ).json()) as { result: { content: unknown[] } }
      expect(call.result.content).toEqual([{ type: 'text', text: 'ran' }])
      const unknown = (await (
        await rpc({ id: 4, method: 'tools/call', params: { name: 'Bash' } })
      ).json()) as {
        error: { code: number }
      }
      expect(unknown.error.code).toBe(-32602)
      expect(calls).toEqual([{ name: 'runCode', args: { code: '1' } }])
    } finally {
      server.stop()
    }
  })
})

describe('teler link: the helper loop', () => {
  const taskId = 'atask_01m6g8vpeye9wsphes2mht0r0b'

  function fakeApi(polls: Array<{ frames: LinkFrame[]; nextUpSeq: Record<string, number> }>) {
    const posted: Array<{ taskId: string; seq: number } & LinkUpFrame> = []
    const api = {
      async poll(_secret: string, input: { signal?: AbortSignal }) {
        const next = polls.shift()
        if (next) return { ...next, chatTurnEngine: 'claude_code' as const }
        await new Promise((resolve) => input.signal?.addEventListener('abort', resolve))
        throw new Error('stopped')
      },
      async postFrames(
        _secret: string,
        frames: Array<{ taskId: string; seq: number } & LinkUpFrame>
      ) {
        posted.push(...frames)
      },
    }
    return { api, posted }
  }

  const turnStart: LinkFrame = { taskId, seq: 0, kind: 'turn.start', payload: {} }

  test('ends a turn it already answered before restarting, instead of running it again', async () => {
    const { api, posted } = fakeApi([{ frames: [turnStart], nextUpSeq: { [taskId]: 4 } }])
    const stop = new AbortController()
    const done = runLinkHelper(
      {
        api,
        secret: 'tlk_x',
        workDir: '/tmp/teler-link-test',
        detectEngines: async () => [{ engine: 'claude_code', version: '2.1.317', signedIn: true }],
        log: () => undefined,
      },
      stop.signal
    )
    for (let attempt = 0; attempt < 50 && posted.length === 0; attempt++) await Bun.sleep(10)
    stop.abort()
    await done
    expect(posted).toEqual([
      { taskId, seq: 4, kind: 'turn.done', payload: { status: 'failed', error: 'restarted' } },
    ])
  })
})
