import { randomBytes } from 'node:crypto'
import type { LinkTurnError, LinkUpFrame } from './protocol'

type Json = Record<string, unknown>

function record(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/** The MCP server name Teler's tools are served under in every Codex Link turn. */
export const CODEX_TELER_SERVER = 'teler'

/** Items a Link turn may produce; any other kind means Codex ran something of its own. */
const ALLOWED_ITEMS = new Set(['agent_message', 'reasoning', 'error', 'todo_list', 'mcp_tool_call'])

/** A Codex failure message as one of Link's turn errors. */
export function codexTurnError(
  message: string
): Extract<LinkTurnError, 'engine_failed' | 'engine_rate_limited' | 'engine_signed_out'> {
  if (/usage limit|rate limit|limit reached|too many requests|\b429\b/i.test(message))
    return 'engine_rate_limited'
  if (
    /\b401\b|unauthori[sz]ed|not logged in|log ?in again|sign ?in again|token.*expired/i.test(
      message
    )
  )
    return 'engine_signed_out'
  return 'engine_failed'
}

/**
 * Reads `codex exec --json` for one turn. Codex reports whole items, not token deltas: each
 * message's text goes out when it completes. Each call to one of Teler's tools is announced as a
 * response of its own (Teler pairs every call with the response that asked for it), and the turn's
 * usage, which Codex reports once, goes out as the last response. Reasoning is not forwarded.
 */
export class CodexStreamReader {
  private readonly announcedCalls: Array<{ callId: string; name: string }> = []
  private announced = 0
  private forbiddenKind: string | null = null
  private result: { status: 'completed' } | { status: 'failed'; error: LinkTurnError } | null = null

  constructor(private readonly io: { emit(frame: LinkUpFrame): void }) {}

  /** Calls to Teler's tools Codex announced so far. */
  announcedToolCalls(): number {
    return this.announced
  }

  /** The id announced for the next call of this tool, in the order Codex announced them. */
  takeToolCallId(name: string): string | undefined {
    const index = this.announcedCalls.findIndex((call) => call.name === name)
    if (index < 0) return undefined
    return this.announcedCalls.splice(index, 1)[0]?.callId
  }

  /** The kind of item that should never appear in a Link turn, if one did. */
  forbidden(): string | null {
    return this.forbiddenKind
  }

  async read(stream: ReadableStream<Uint8Array>, onForbidden?: () => void): Promise<void> {
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        this.line(buffer.slice(0, newline), onForbidden)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) this.line(buffer, onForbidden)
  }

  outcome(stopped: boolean): Extract<LinkUpFrame, { kind: 'turn.done' }>['payload'] {
    if (stopped) return { status: 'interrupted' }
    if (this.forbiddenKind || !this.result) return { status: 'failed', error: 'engine_failed' }
    return this.result
  }

  private line(text: string, onForbidden?: () => void): void {
    let message: Json | null
    try {
      message = record(JSON.parse(text))
    } catch {
      return
    }
    if (!message || this.forbiddenKind) return
    const item = record(message.item)
    if (item && typeof item.type === 'string') {
      const foreignTool = item.type === 'mcp_tool_call' && item.server !== CODEX_TELER_SERVER
      if (!ALLOWED_ITEMS.has(item.type) || foreignTool) {
        this.forbiddenKind = foreignTool ? 'mcp_tool_call' : item.type
        onForbidden?.()
        return
      }
    }
    switch (message.type) {
      case 'item.started':
        if (item?.type === 'mcp_tool_call' && typeof item.tool === 'string')
          this.announce(item.tool)
        return
      case 'item.completed':
        if (item?.type === 'agent_message' && typeof item.text === 'string' && item.text) {
          const itemId = `codex_${randomBytes(6).toString('hex')}`
          this.io.emit({ kind: 'text.delta', payload: { itemId, delta: item.text } })
          this.io.emit({ kind: 'text.done', payload: { itemId } })
        }
        return
      case 'turn.completed': {
        const usage = record(message.usage)
        const cached = count(usage?.cached_input_tokens)
        const cacheWrite = count(usage?.cache_write_input_tokens)
        this.io.emit({
          kind: 'response.done',
          payload: {
            inputTokens: Math.max(count(usage?.input_tokens), cached + cacheWrite),
            cachedInputTokens: cached,
            cacheWriteTokens: cacheWrite,
            outputTokens: count(usage?.output_tokens),
            toolCalls: 0,
            toolCallIds: [],
          },
        })
        this.result = { status: 'completed' }
        return
      }
      case 'turn.failed': {
        const error = record(message.error)
        const text = typeof error?.message === 'string' ? error.message : ''
        this.result = { status: 'failed', error: codexTurnError(text) }
        return
      }
      default:
        return
    }
  }

  private announce(name: string): void {
    const callId = `call_${randomBytes(8).toString('hex')}`
    this.io.emit({
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
    this.announcedCalls.push({ callId, name })
    this.announced += 1
  }
}
