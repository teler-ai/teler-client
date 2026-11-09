import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexTurnError, CodexStreamReader } from '../src/link/codex-stream'
import {
  CODEX_DISABLED_FEATURES,
  CODEX_TOKEN_VARIABLE,
  codexArguments,
  codexEnvironment,
  runCodexTurn,
} from '../src/link/codex-turn'
import type { LinkUpFrame } from '../src/link/protocol'

function stream(lines: unknown[]): ReadableStream<Uint8Array> {
  const text = lines
    .map((line) => (typeof line === 'string' ? line : JSON.stringify(line)))
    .join('\n')
  return new Response(`${text}\n`).body as ReadableStream<Uint8Array>
}

function configOf(args: string[]): string[] {
  return args.flatMap((arg, index) => (args[index - 1] === '-c' ? [arg] : []))
}

describe('teler link: Codex options', () => {
  const args = codexArguments({
    mcpUrl: 'http://127.0.0.1:4100/mcp',
    instructionsPath: '/tmp/turn/instructions.md',
    workDir: '/tmp/work',
    model: 'gpt-test',
    effort: 'medium',
  })
  const config = configOf(args)

  test('runs exec on nothing of the member: ephemeral, no config, rules or docs', () => {
    expect(args.slice(0, 2)).toEqual(['exec', '--json'])
    for (const flag of [
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
    ])
      expect(args).toContain(flag)
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only')
    expect(args[args.indexOf('--cd') + 1]).toBe('/tmp/work')
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-test')
    expect(config).toContain('approval_policy="never"')
    expect(config).toContain('model_reasoning_effort="medium"')
    expect(config).toContain('model_instructions_file="/tmp/turn/instructions.md"')
    expect(config).toContain('project_doc_max_bytes=0')
    expect(config).toContain('skills.include_instructions=false')
    expect(config).toContain('include_environment_context=false')
    expect(args.some((arg) => arg.includes('dangerously'))).toBe(false)
    expect(args.some((arg) => /^--(full-auto|approve-for-me|add-dir|enable)/.test(arg))).toBe(false)
  })

  test('turns off every built-in tool: shell, files, web, browser, computer, apps', () => {
    for (const feature of [
      'shell_tool',
      'unified_exec',
      'apps',
      'plugins',
      'browser_use',
      'computer_use',
      'image_generation',
      'view_image',
      'multi_agent',
      'hooks',
    ])
      expect(config).toContain(`features.${feature}=false`)
    expect(config.filter((entry) => /^features\.[a-z0-9_]+=false$/.test(entry)).length).toBe(
      CODEX_DISABLED_FEATURES.length as number
    )
    expect(config).toContain('web_search="disabled"')
    // Sub-agents and questions to the member, which no feature flag turns off.
    expect(config).toContain('agents.enabled=false')
    expect(config).toContain('tools.experimental_request_user_input.enabled=false')
  })

  test("keeps code mode from hiding Teler's tools and drops Codex's own from it", () => {
    expect(config).toContain('features.code_mode_only_strict_3p_tools=false')
    expect(config).toContain('features.code_mode.enabled=false')
    expect(config).toContain('features.code_mode.excluded_tool_namespaces=["functions","clock"]')
    expect(config).toContain('mcp_servers.teler.omit_tools_from=["code_mode","deferred"]')
    expect(config).toContain('mcp_servers.teler.tool_input_schema_max_bytes=65536')
  })

  test("offers only Teler's tools from the loopback server, its token kept off the command line", () => {
    const mcp = config.filter((entry) => entry.startsWith('mcp_servers.'))
    expect(mcp.every((entry) => entry.startsWith('mcp_servers.teler.'))).toBe(true)
    expect(mcp).toContain('mcp_servers.teler.url="http://127.0.0.1:4100/mcp"')
    expect(mcp).toContain(`mcp_servers.teler.bearer_token_env_var="${CODEX_TOKEN_VARIABLE}"`)
    expect(mcp).toContain('mcp_servers.teler.default_tools_approval_mode="approve"')
    const env = codexEnvironment({ HOME: '/home/someone' }, 'secret-token')
    expect(env[CODEX_TOKEN_VARIABLE]).toBe('secret-token')
    expect(args.join(' ')).not.toContain('secret-token')
  })

  test('drops an effort that is not a plain word and passes images as files', () => {
    const odd = codexArguments({
      mcpUrl: 'http://127.0.0.1:1/mcp',
      instructionsPath: 'C:\\Temp\\a "b".md',
      workDir: '/w',
      model: 'm',
      effort: 'x"\nmodel="other',
      imagePaths: ['/tmp/image-1.png'],
    })
    expect(configOf(odd).some((entry) => entry.startsWith('model_reasoning_effort'))).toBe(false)
    expect(configOf(odd)).toContain('model_instructions_file="C:\\\\Temp\\\\a \\"b\\".md"')
    expect(odd).toContain('--image=/tmp/image-1.png')
  })
})

interface RecordedTool {
  type: string
  name: string
  description?: string
  parameters?: unknown
  tools?: RecordedTool[]
}

interface RecordedRequest {
  served: Array<{ name: string; description: string; inputSchema: unknown }>
  request: {
    tools: RecordedTool[] | null
    input: Array<{ type: string; role?: string; text?: string; tools?: RecordedTool[] }>
  }
}

// What Codex 0.167 sent a fake Responses API for one Link turn (`link-codex-tools.json`).
describe('teler link: the tools Codex offers', async () => {
  const recorded = JSON.parse(
    await readFile(join(import.meta.dir, 'link-codex-tools.json'), 'utf8')
  ) as RecordedRequest
  const offered = [
    ...(recorded.request.tools ?? []),
    ...recorded.request.input.flatMap((item) => item.tools ?? []),
  ]
  const namespace = (name: string) => offered.find((tool) => tool.name === name)?.tools ?? []
  const names = (tools: RecordedTool[]): string[] =>
    tools.flatMap((tool) => [tool.name, ...names(tool.tools ?? [])])

  test("offers each of Teler's tools directly, with its full description and schema", () => {
    expect(namespace('mcp__teler')).toEqual(
      recorded.served.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        strict: false,
        parameters: tool.inputSchema,
      }))
    )
  })

  test("leaves only code mode's empty exec and wait of Codex's own", () => {
    expect(offered.map((tool) => tool.name).sort()).toEqual(['functions', 'mcp__teler'])
    expect(names(namespace('functions'))).toEqual(['exec', 'wait'])
    const exec = namespace('functions').find((tool) => tool.name === 'exec')
    // Each tool reachable inside exec is listed under a `### name` heading.
    expect(exec?.description).not.toMatch(/^### /m)
    for (const name of [
      'apply_patch',
      'request_user_input',
      'spawn_agent',
      'list_mcp_resources',
      'read_mcp_resource',
      'exec_command',
    ])
      expect(names(offered)).not.toContain(name)
    expect(recorded.request.input.filter((item) => item.type === 'message')).toEqual([
      { type: 'message', role: 'developer', text: 'Teler instructions.' },
      { type: 'message', role: 'user', text: 'Make a bar chart.' },
    ])
  })
})

describe('teler link: reading Codex', () => {
  test('forwards messages, announces each Teler tool call, and ends with the usage', async () => {
    const frames: LinkUpFrame[] = []
    const reader = new CodexStreamReader({ emit: (frame) => frames.push(frame) })
    await reader.read(
      stream([
        { type: 'thread.started', thread_id: '00000000-0000-0000-0000-000000000000' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'a warning' } },
        { type: 'item.completed', item: { id: 'item_1', type: 'reasoning', text: 'secret' } },
        {
          type: 'item.completed',
          item: { id: 'item_2', type: 'agent_message', text: 'Checking.' },
        },
        {
          type: 'item.started',
          item: {
            id: 'item_3',
            type: 'mcp_tool_call',
            server: 'teler',
            tool: 'runCode',
            arguments: { code: '1' },
            result: null,
            error: null,
            status: 'in_progress',
          },
        },
        {
          type: 'item.completed',
          item: {
            id: 'item_3',
            type: 'mcp_tool_call',
            server: 'teler',
            tool: 'runCode',
            status: 'completed',
          },
        },
        'not json',
        { type: 'item.completed', item: { id: 'item_4', type: 'agent_message', text: 'It is 1.' } },
        {
          type: 'turn.completed',
          usage: {
            input_tokens: 17_575,
            cached_input_tokens: 12_288,
            cache_write_input_tokens: 0,
            output_tokens: 6,
            reasoning_output_tokens: 0,
          },
        },
      ])
    )
    const kinds = frames.map((frame) => frame.kind)
    expect(kinds).toEqual([
      'text.delta',
      'text.done',
      'response.done',
      'text.delta',
      'text.done',
      'response.done',
    ])
    expect(frames[0]).toMatchObject({ payload: { delta: 'Checking.' } })
    const announced = frames[2] as Extract<LinkUpFrame, { kind: 'response.done' }>
    expect(announced.payload.toolCalls).toBe(1)
    const [callId] = announced.payload.toolCallIds
    expect(callId).toMatch(/^call_[0-9a-f]{16}$/)
    expect(reader.announcedToolCalls()).toBe(1)
    expect(reader.takeToolCallId('other')).toBeUndefined()
    expect(reader.takeToolCallId('runCode')).toBe(callId as string)
    expect(frames[5]).toEqual({
      kind: 'response.done',
      payload: {
        inputTokens: 17_575,
        cachedInputTokens: 12_288,
        cacheWriteTokens: 0,
        outputTokens: 6,
        toolCalls: 0,
        toolCallIds: [],
      },
    })
    expect(JSON.stringify(frames)).not.toContain('secret')
    expect(reader.outcome(false)).toEqual({ status: 'completed' })
    expect(reader.outcome(true)).toEqual({ status: 'interrupted' })
  })

  test('maps plan limits and sign-outs, and fails a turn without an end', async () => {
    const failed = async (message: string) => {
      const reader = new CodexStreamReader({ emit: () => undefined })
      await reader.read(stream([{ type: 'turn.failed', error: { message } }]))
      return reader.outcome(false)
    }
    expect(await failed('You’ve hit your usage limit. Try again later.')).toEqual({
      status: 'failed',
      error: 'engine_rate_limited',
    })
    expect(await failed('unexpected status 401 Unauthorized: Missing bearer')).toEqual({
      status: 'failed',
      error: 'engine_signed_out',
    })
    expect(codexTurnError('stream disconnected')).toBe('engine_failed')
    const silent = new CodexStreamReader({ emit: () => undefined })
    await silent.read(stream([{ type: 'turn.started' }]))
    expect(silent.outcome(false)).toEqual({ status: 'failed', error: 'engine_failed' })
  })

  test('stops a turn the moment Codex runs anything but Teler’s tools', async () => {
    for (const item of [
      { id: 'item_1', type: 'command_execution', command: 'ls' },
      { id: 'item_1', type: 'file_change' },
      { id: 'item_1', type: 'web_search' },
      { id: 'item_1', type: 'mcp_tool_call', server: 'other', tool: 'x' },
    ]) {
      let stopped = 0
      const frames: LinkUpFrame[] = []
      const reader = new CodexStreamReader({ emit: (frame) => frames.push(frame) })
      await reader.read(
        stream([
          { type: 'item.started', item },
          { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
        ]),
        () => (stopped += 1)
      )
      expect(stopped).toBe(1)
      expect(frames).toEqual([])
      expect(reader.outcome(false)).toEqual({ status: 'failed', error: 'engine_failed' })
    }
  })
})

const FAKE_CODEX = `
const log = process.env.FAKE_CODEX_LOG
const args = process.argv.slice(2)
const url = JSON.parse(args.find((a) => a.startsWith('mcp_servers.teler.url=')).slice(22))
const token = process.env.${CODEX_TOKEN_VARIABLE}
const prompt = await new Response(Bun.stdin.stream()).text()
await Bun.write(log, JSON.stringify({ args, prompt }))
const out = (o) => console.log(JSON.stringify(o))
out({ type: 'thread.started', thread_id: 't' })
out({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'Checking.' } })
out({ type: 'item.started', item: { id: 'item_1', type: 'mcp_tool_call', server: 'teler', tool: 'runCode' } })
const response = await fetch(url, {
  method: 'POST',
  headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'runCode', arguments: { code: '1' } } }),
})
const result = (await response.json()).result
out({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Done: ' + result.content[0].text } })
out({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 } })
`

describe('teler link: a Codex turn', () => {
  test.skipIf(process.platform === 'win32')(
    "runs Codex with Teler's tools, forwards a call and returns its result",
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'teler-link-codex-'))
      try {
        await writeFile(join(root, 'fake.ts'), FAKE_CODEX)
        const binary = join(root, 'codex')
        await writeFile(
          binary,
          `#!/bin/sh\nexec "${process.execPath}" "${join(root, 'fake.ts')}" "$@"\n`
        )
        await chmod(binary, 0o755)
        const frames: LinkUpFrame[] = []
        await runCodexTurn({
          turn: {
            protocol: 1,
            engine: 'codex',
            account: 'default',
            model: 'gpt-test',
            reasoningEffort: 'medium',
            instructions: 'Be Teler.',
            history: [],
            input: [{ type: 'text', text: 'What is 1?' }],
            tools: [{ name: 'runCode', description: 'Run code', inputSchema: { type: 'object' } }],
          },
          engineVersion: '0.167.0',
          stop: new AbortController().signal,
          workDir: join(root, 'work'),
          env: {
            ...process.env,
            TELER_LINK_CODEX_BIN: binary,
            FAKE_CODEX_LOG: join(root, 'log.json'),
          },
          io: {
            emit: (frame) => frames.push(frame),
            awaitToolResult: async (callId) => ({
              callId,
              success: true,
              content: [{ type: 'text', text: 'ran' }],
            }),
          },
        })
        const kinds = frames.map((frame) => frame.kind)
        expect(kinds).toEqual([
          'turn.accepted',
          'text.delta',
          'text.done',
          'response.done',
          'tool.call',
          'text.delta',
          'text.done',
          'response.done',
          'turn.done',
        ])
        const announced = frames[3] as Extract<LinkUpFrame, { kind: 'response.done' }>
        expect(frames[4]).toEqual({
          kind: 'tool.call',
          payload: {
            callId: announced.payload.toolCallIds[0] as string,
            name: 'runCode',
            arguments: { code: '1' },
          },
        })
        expect(frames[5]).toMatchObject({ payload: { delta: 'Done: ran' } })
        expect(frames[8]).toEqual({ kind: 'turn.done', payload: { status: 'completed' } })
        const log = JSON.parse(await readFile(join(root, 'log.json'), 'utf8')) as {
          args: string[]
          prompt: string
        }
        expect(log.prompt).toContain('What is 1?')
        expect(log.args).toContain('--ignore-user-config')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )
})
