import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexBinary } from './engines'
import type { LinkTurnStart } from './protocol'
import { CODEX_TELER_SERVER, CodexStreamReader } from './codex-stream'
import { startToolServer } from './tool-server'
import { buildClaudePrompt } from './transcript'
import { stoppedOutcome, toolOutcome, waitForAnnouncement, type TurnIO } from './turn-io'

/** Codex reads the tool server's bearer token from this variable, so it is never an argument. */
export const CODEX_TOKEN_VARIABLE = 'TELER_LINK_MCP_TOKEN'

/**
 * Codex features that give the model a tool of its own (shell, files, web, browser, computer,
 * apps, plugins, images, sub-agents, goals, memories) or run something on this computer (hooks).
 * Set through `-c features.<name>=false`, which a Codex release without the feature ignores.
 */
export const CODEX_DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'apps',
  'plugins',
  'browser_use',
  'browser_use_external',
  'in_app_browser',
  'computer_use',
  'image_generation',
  'view_image',
  'multi_agent',
  'multi_agent_v2',
  'goals',
  'memories',
  'hooks',
  'tool_suggest',
  'skill_search',
  'sleep_tool',
  // Would keep MCP tools inside `exec` whatever `omit_tools_from` says.
  'code_mode_only_strict_3p_tools',
] as const

const toml = (value: string) => JSON.stringify(value)
const tomlList = (values: readonly string[]) => `[${values.map(toml).join(',')}]`

/**
 * Tool namespaces Codex keeps out of its JavaScript `exec` tool. Newer models run in code mode:
 * every tool but `exec` and `wait` lives inside `exec`, and an MCP server's tools hide behind a
 * catalog the model must search, so it never reads their descriptions. In code mode, excluded
 * namespaces are dropped entirely, which takes away Codex's own file patch, MCP resource readers
 * and clock. A model without code mode keeps the resource readers, which read only Teler's server.
 */
export const CODEX_EXCLUDED_CODE_MODE_NAMESPACES = ['functions', 'clock'] as const

/**
 * The fixed options every Link turn runs Codex with: `exec` on the member's own sign-in, no saved
 * session, none of the member's config, rules, project docs or skills, never asking for approval,
 * no shell, web, browser, computer, apps, plugins, sub-agents or questions to the member, and
 * Teler's tools from this turn's local server, offered to the model directly with their full
 * descriptions and schemas, never inside code mode or behind a tool search. Teler's instructions
 * replace Codex's own. Code-mode models still get `exec` and `wait`, a JavaScript isolate with no
 * file system, network or tools of its own; the read-only sandbox refuses every write, and the
 * stream reader ends the turn if Codex reports a command, file change or search of its own.
 */
export function codexArguments(input: {
  mcpUrl: string
  instructionsPath: string
  workDir: string
  model: string
  effort?: string
  imagePaths?: readonly string[]
}): string[] {
  const config = [
    'approval_policy="never"',
    'web_search="disabled"',
    `model_instructions_file=${toml(input.instructionsPath)}`,
    'include_permissions_instructions=false',
    'include_environment_context=false',
    'include_apps_instructions=false',
    'include_collaboration_mode_instructions=false',
    'project_doc_max_bytes=0',
    'skills.include_instructions=false',
    'history.persistence="none"',
    'agents.enabled=false',
    'tools.experimental_request_user_input.enabled=false',
    ...CODEX_DISABLED_FEATURES.map((feature) => `features.${feature}=false`),
    // A table, so it would turn code mode on for a model that does not ask for it.
    'features.code_mode.enabled=false',
    `features.code_mode.excluded_tool_namespaces=${tomlList(CODEX_EXCLUDED_CODE_MODE_NAMESPACES)}`,
    `mcp_servers.${CODEX_TELER_SERVER}.url=${toml(input.mcpUrl)}`,
    `mcp_servers.${CODEX_TELER_SERVER}.bearer_token_env_var=${toml(CODEX_TOKEN_VARIABLE)}`,
    `mcp_servers.${CODEX_TELER_SERVER}.default_tools_approval_mode="approve"`,
    // Teler's tools go to the model as plain function tools, never in `exec` or a tool search.
    `mcp_servers.${CODEX_TELER_SERVER}.omit_tools_from=${tomlList(['code_mode', 'deferred'])}`,
    // Codex compacts a larger schema and drops its parameter descriptions.
    `mcp_servers.${CODEX_TELER_SERVER}.tool_input_schema_max_bytes=65536`,
    // Teler's tools can take minutes (code in the sandbox); Teler bounds the turn itself.
    `mcp_servers.${CODEX_TELER_SERVER}.tool_timeout_sec=1800`,
    `mcp_servers.${CODEX_TELER_SERVER}.startup_timeout_sec=30`,
    ...(input.effort && /^[a-z_]{1,16}$/.test(input.effort)
      ? [`model_reasoning_effort=${toml(input.effort)}`]
      : []),
  ]
  return [
    'exec',
    '--json',
    '--ephemeral',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    'read-only',
    '--cd',
    input.workDir,
    '--model',
    input.model,
    ...config.flatMap((entry) => ['-c', entry]),
    ...(input.imagePaths ?? []).map((path) => `--image=${path}`),
    // The prompt follows on stdin.
  ]
}

export function codexEnvironment(env: NodeJS.ProcessEnv, token: string): NodeJS.ProcessEnv {
  return { ...env, [CODEX_TOKEN_VARIABLE]: token }
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** Run one Teler chat turn on this computer's Codex. */
export async function runCodexTurn(input: {
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
    payload: { engine: 'codex', engineVersion: input.engineVersion },
  })
  await mkdir(input.workDir, { recursive: true, mode: 0o700 })
  const scratch = await mkdtemp(join(tmpdir(), 'teler-link-'))
  const reader = new CodexStreamReader(io)
  let callCount = 0
  const server = startToolServer(turn.tools, async (name, args) => {
    // Teler pairs each call with the response that asked for it: wait for Codex to announce it.
    await waitForAnnouncement(() => reader.announcedToolCalls() > callCount)
    callCount += 1
    if (input.stop.aborted) return stoppedOutcome()
    let callId = reader.takeToolCallId(name)
    if (!callId) {
      callId = `call_${randomBytes(8).toString('hex')}`
      io.emit({
        kind: 'response.done',
        payload: {
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          toolCalls: 1,
          toolCallIds: [callId],
        },
      })
    }
    io.emit({ kind: 'tool.call', payload: { callId, name, arguments: args } })
    try {
      return toolOutcome(await io.awaitToolResult(callId, input.stop))
    } catch {
      return stoppedOutcome()
    }
  })
  try {
    const instructionsPath = join(scratch, 'instructions.md')
    await writeFile(instructionsPath, turn.instructions, { mode: 0o600 })
    const prompt = buildClaudePrompt(turn.history, turn.input)
    const imagePaths: string[] = []
    for (const [index, image] of prompt.images.entries()) {
      const path = join(scratch, `image-${index + 1}.${IMAGE_EXTENSIONS[image.mediaType] ?? 'png'}`)
      await writeFile(path, Buffer.from(image.data, 'base64'), { mode: 0o600 })
      imagePaths.push(path)
    }
    const child = Bun.spawn(
      [
        codexBinary(env),
        ...codexArguments({
          mcpUrl: server.url,
          instructionsPath,
          workDir: input.workDir,
          model: turn.model,
          imagePaths,
          ...(turn.reasoningEffort ? { effort: turn.reasoningEffort } : {}),
        }),
      ],
      {
        cwd: input.workDir,
        env: codexEnvironment(env, server.token),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'ignore',
      }
    )
    const stopChild = () => child.kill('SIGTERM')
    input.stop.addEventListener('abort', stopChild, { once: true })
    child.stdin.write(prompt.text)
    child.stdin.end()
    // Anything but Teler's tools ends the turn at once.
    await reader.read(child.stdout, stopChild)
    await child.exited
    input.stop.removeEventListener('abort', stopChild)
    io.emit({ kind: 'turn.done', payload: reader.outcome(input.stop.aborted) })
  } finally {
    server.stop()
    await rm(scratch, { recursive: true, force: true })
  }
}
