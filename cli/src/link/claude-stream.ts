import type { LinkUpFrame } from './protocol'

type Json = Record<string, unknown>

function record(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/**
 * Reads Claude Code's stream-json output for one turn: each provider response's text as it
 * streams, its usage and tool-use count when it ends, and the turn's result. Thinking is not
 * forwarded. Anything that is not JSON is ignored.
 */
export class ClaudeStreamReader {
  private response = 0
  private usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }
  private toolUseIds: string[] = []
  private readonly announcedIds: string[] = []
  private announced = 0
  private readonly textBlocks = new Map<number, string>()
  private result: {
    status: 'completed' | 'failed'
    error?: 'engine_failed' | 'engine_rate_limited'
  } | null = null

  constructor(private readonly io: { emit(frame: LinkUpFrame): void }) {}

  /** Tool calls the ended responses asked for, so far. */
  announcedToolCalls(): number {
    return this.announced
  }

  /** The id of the next announced tool call, in the order Claude Code makes the calls. */
  takeToolCallId(): string | undefined {
    return this.announcedIds.shift()
  }

  async read(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        this.line(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) this.line(buffer)
  }

  outcome(stopped: boolean): Extract<LinkUpFrame, { kind: 'turn.done' }>['payload'] {
    if (stopped) return { status: 'interrupted' }
    if (!this.result) return { status: 'failed', error: 'engine_failed' }
    return this.result.status === 'completed'
      ? { status: 'completed' }
      : { status: 'failed', error: this.result.error ?? 'engine_failed' }
  }

  private line(text: string): void {
    let message: Json | null
    try {
      message = record(JSON.parse(text))
    } catch {
      return
    }
    if (!message) return
    if (message.type === 'stream_event') this.event(record(message.event))
    else if (message.type === 'result') {
      const failed = message.is_error === true || message.subtype !== 'success'
      const resultText = typeof message.result === 'string' ? message.result : ''
      this.result = failed
        ? {
            status: 'failed',
            error: /rate limit|usage limit|limit reached/i.test(resultText)
              ? 'engine_rate_limited'
              : 'engine_failed',
          }
        : { status: 'completed' }
    }
  }

  private event(event: Json | null): void {
    if (!event) return
    switch (event.type) {
      case 'message_start': {
        this.response += 1
        this.toolUseIds = []
        this.textBlocks.clear()
        const usage = record(record(event.message)?.usage)
        this.usage = {
          input: count(usage?.input_tokens),
          cacheWrite: count(usage?.cache_creation_input_tokens),
          cacheRead: count(usage?.cache_read_input_tokens),
          output: count(usage?.output_tokens),
        }
        return
      }
      case 'content_block_start': {
        const index = count(event.index)
        const block = record(event.content_block)
        if (block?.type === 'text') this.textBlocks.set(index, `msg${this.response}_${index}`)
        if (block?.type === 'tool_use') {
          const id = typeof block.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(block.id)
          this.toolUseIds.push(id ? (block.id as string) : `call_${this.response}_${index}`)
        }
        return
      }
      case 'content_block_delta': {
        const itemId = this.textBlocks.get(count(event.index))
        const delta = record(event.delta)
        if (itemId && delta?.type === 'text_delta' && typeof delta.text === 'string') {
          this.io.emit({ kind: 'text.delta', payload: { itemId, delta: delta.text } })
        }
        return
      }
      case 'content_block_stop': {
        const itemId = this.textBlocks.get(count(event.index))
        if (itemId) this.io.emit({ kind: 'text.done', payload: { itemId } })
        return
      }
      case 'message_delta': {
        const usage = record(event.usage)
        if (usage?.output_tokens !== undefined) this.usage.output = count(usage.output_tokens)
        if (usage?.input_tokens !== undefined) this.usage.input = count(usage.input_tokens)
        if (usage?.cache_read_input_tokens !== undefined)
          this.usage.cacheRead = count(usage.cache_read_input_tokens)
        if (usage?.cache_creation_input_tokens !== undefined)
          this.usage.cacheWrite = count(usage.cache_creation_input_tokens)
        return
      }
      case 'message_stop': {
        const { input, cacheWrite, cacheRead, output } = this.usage
        this.io.emit({
          kind: 'response.done',
          payload: {
            inputTokens: input + cacheWrite + cacheRead,
            cachedInputTokens: cacheRead,
            cacheWriteTokens: cacheWrite,
            outputTokens: output,
            toolCalls: this.toolUseIds.length,
            toolCallIds: [...this.toolUseIds],
          },
        })
        this.announced += this.toolUseIds.length
        this.announcedIds.push(...this.toolUseIds)
        return
      }
      default:
        return
    }
  }
}
