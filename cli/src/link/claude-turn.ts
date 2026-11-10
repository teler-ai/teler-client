import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeBinary } from './engines'
import type { LinkTurnStart } from './protocol'
import { ClaudeStreamReader } from './claude-stream'
import { startToolServer } from './tool-server'
import { buildClaudePrompt } from './transcript'
import {
  engineBaseEnvironment,
  stoppedOutcome,
  toolOutcome,
  waitForAnnouncement,
  type TurnIO,
} from './turn-io'

export type { TurnIO } from './turn-io'

/**
 * The fixed options every Link turn runs Claude Code with: print mode on the member's own
 * sign-in, no built-in tools (no shell, files or web), no settings, hooks or other MCP servers,
 * no saved session, and only Teler's tools from this turn's local server, allowed up front.
 */
export function claudeArguments(input: {
  mcpConfigPath: string
  instructionsPath: string
  model: string
  effort?: string
}): string[] {
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--restricted',
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    input.mcpConfigPath,
    '--allowedTools',
    'mcp__teler',
    '--permission-prompts',
    'none',
    '--append-system-prompt-file',
    input.instructionsPath,
    '--model',
    input.model,
    ...(input.effort ? ['--effort', input.effort] : []),
    '--no-session-persistence',
    '--settings',
    '{"disableAllHooks":true}',
  ]
}

export function claudeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...engineBaseEnvironment(env),
    // No claude.ai connectors and no IDE: the turn sees Teler's tools only.
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    CLAUDE_CODE_AUTO_CONNECT_IDE: '0',
    // Teler's tools can take minutes (code in the sandbox); Teler bounds the turn itself.
    MCP_TOOL_TIMEOUT: '1800000',
  }
}

/** Run one Teler chat turn on this computer's Claude Code. */
export async function runClaudeTurn(input: {
  turn: LinkTurnStart
  engineVersion: string
  io: TurnIO
  stop: AbortSignal
  workDir: string
  env?: NodeJS.ProcessEnv
}): Promise<void> {
  const env = input.env ?? process.env
  const { io, turn } = input
  io.emit({
    kind: 'turn.accepted',
    payload: { engine: 'claude_code', engineVersion: input.engineVersion },
  })
  await mkdir(input.workDir, { recursive: true, mode: 0o700 })
  const scratch = await mkdtemp(join(tmpdir(), 'teler-link-'))
  const reader = new ClaudeStreamReader(io)
  let callCount = 0
  const server = startToolServer(turn.tools, async (name, args) => {
    // Teler pairs each call with the provider response that asked for it.
    await waitForAnnouncement(() => reader.announcedToolCalls() > callCount)
    callCount += 1
    if (input.stop.aborted) return stoppedOutcome()
    // Calls are made in the order the response asked for them, so they take its ids in turn.
    const callId =
      reader.takeToolCallId() ??
      `call_${callCount}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
    io.emit({ kind: 'tool.call', payload: { callId, name, arguments: args } })
    try {
      return toolOutcome(await io.awaitToolResult(callId, input.stop))
    } catch {
      return stoppedOutcome()
    }
  })
  try {
    const mcpConfigPath = join(scratch, 'mcp.json')
    const instructionsPath = join(scratch, 'instructions.md')
    await writeFile(
      mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          teler: {
            type: 'http',
            url: server.url,
            headers: { Authorization: `Bearer ${server.token}` },
          },
        },
      }),
      { mode: 0o600 }
    )
    await writeFile(instructionsPath, turn.instructions, { mode: 0o600 })
    const prompt = buildClaudePrompt(turn.history, turn.input)
    const child = Bun.spawn(
      [
        claudeBinary(env),
        ...claudeArguments({
          mcpConfigPath,
          instructionsPath,
          model: turn.model,
          ...(turn.reasoningEffort ? { effort: turn.reasoningEffort } : {}),
        }),
      ],
      {
        cwd: input.workDir,
        env: claudeEnvironment(env),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'ignore',
      }
    )
    const stopChild = () => child.kill('SIGTERM')
    input.stop.addEventListener('abort', stopChild, { once: true })
    child.stdin.write(
      `${JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: prompt.text },
            ...prompt.images.map((image) => ({
              type: 'image',
              source: { type: 'base64', media_type: image.mediaType, data: image.data },
            })),
          ],
        },
      })}\n`
    )
    child.stdin.end()
    await reader.read(child.stdout)
    await child.exited
    input.stop.removeEventListener('abort', stopChild)
    io.emit({ kind: 'turn.done', payload: reader.outcome(input.stop.aborted) })
  } finally {
    server.stop()
    await rm(scratch, { recursive: true, force: true })
  }
}
