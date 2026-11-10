import type { LinkToolResult, LinkUpFrame } from './protocol'
import type { ToolCallOutcome } from './tool-server'

export interface TurnIO {
  /** Queue a frame for Teler; frames leave in the order they are emitted. */
  emit(frame: LinkUpFrame): void
  /** Resolves with Teler's result for a tool call this turn made. */
  awaitToolResult(callId: string, signal: AbortSignal): Promise<LinkToolResult>
}

/** This computer's Teler pairing and sign-ins: the helper's own, never the engine's. */
const TELER_SECRETS = ['TELER_LINK_PAIRING', 'TELER_ACCESS_TOKEN', 'TELER_TOKEN'] as const

/** The helper's environment for an engine process, without Teler's own secrets. */
export function engineBaseEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env }
  for (const name of TELER_SECRETS) delete copy[name]
  return copy
}

/** A tool call can arrive just before the stream announces it; this long at most. */
export const RESPONSE_GATE_MS = 10_000

/** Teler's result for a tool call, as MCP content for the engine. */
export function toolOutcome(result: LinkToolResult): ToolCallOutcome {
  return {
    isError: !result.success,
    content: result.content.map((part) => {
      if (part.type === 'text') return { type: 'text' as const, text: part.text }
      const match = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(part.url)
      return match
        ? { type: 'image' as const, mimeType: match[1] as string, data: match[2] as string }
        : { type: 'text' as const, text: '[an image Teler could not pass on]' }
    }),
  }
}

export function stoppedOutcome(): ToolCallOutcome {
  return { isError: true, content: [{ type: 'text', text: 'Teler stopped this turn.' }] }
}

/** Waits until `ready()` or the gate's deadline, whichever comes first. */
export async function waitForAnnouncement(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + RESPONSE_GATE_MS
  while (!ready() && Date.now() < deadline) await Bun.sleep(20)
}
