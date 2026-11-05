import { z } from 'zod'

/** The Teler Link data protocol this helper speaks; Teler refuses a helper on another one. */
export const LINK_PROTOCOL_VERSION = 1

export const LINK_ENGINES = ['claude_code', 'codex'] as const
export type LinkEngine = (typeof LINK_ENGINES)[number]

/** What the helper found on this computer, reported to Teler on every poll. */
export interface LinkEngineInfo {
  engine: LinkEngine
  version: string
  signedIn: boolean
  plan?: string
}

const contentSchema = z.array(
  z.union([
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('image'), url: z.string() }),
  ])
)
export type LinkContent = z.infer<typeof contentSchema>

export const toolSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,127}$/),
  description: z.string(),
  inputSchema: z.unknown(),
})
export type LinkTool = z.infer<typeof toolSchema>

export const turnStartSchema = z.object({
  protocol: z.literal(LINK_PROTOCOL_VERSION),
  engine: z.enum(LINK_ENGINES),
  model: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
  reasoningEffort: z.string().max(16).optional(),
  instructions: z.string(),
  history: z.array(z.unknown()),
  input: contentSchema,
  tools: z.array(toolSchema),
})
export type LinkTurnStart = z.infer<typeof turnStartSchema>

export const toolResultSchema = z.object({
  callId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  success: z.boolean(),
  content: contentSchema,
})
export type LinkToolResult = z.infer<typeof toolResultSchema>

const frameSchema = z.object({
  taskId: z.string().regex(/^atask_[0-9a-z]{26}$/),
  seq: z.number().int().min(0),
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()),
})
export type LinkFrame = z.infer<typeof frameSchema>

export const pollResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    frames: z.array(frameSchema),
    /** For each turn in `frames`, the number its next helper frame must carry. */
    nextUpSeq: z.record(z.string(), z.number().int().min(0)).default({}),
    chatTurnEngine: z.enum(LINK_ENGINES).nullable(),
  }),
})

export const pairResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    deviceId: z.string().regex(/^lnkdev_[0-9a-z]{26}$/),
    secret: z.string().regex(/^tlk_[A-Za-z0-9_-]{43}$/),
    organizationId: z.string().min(1),
  }),
})

/** What the helper sends back for a turn, numbered per turn. */
export type LinkUpFrame =
  | { kind: 'turn.accepted'; payload: { engine: LinkEngine; engineVersion: string } }
  | { kind: 'text.delta'; payload: { itemId: string; delta: string } }
  | { kind: 'text.done'; payload: { itemId: string } }
  | {
      kind: 'response.done'
      payload: {
        inputTokens: number
        cachedInputTokens: number
        cacheWriteTokens: number
        outputTokens: number
        toolCalls: number
        /** Their ids, in order: the ids of the tool.call frames that follow. */
        toolCallIds: string[]
      }
    }
  | { kind: 'tool.call'; payload: { callId: string; name: string; arguments: unknown } }
  | {
      kind: 'turn.done'
      payload: { status: 'completed' | 'interrupted' | 'failed'; error?: LinkTurnError }
    }

export type LinkTurnError =
  | 'engine_missing'
  | 'engine_signed_out'
  | 'engine_failed'
  | 'engine_rate_limited'
  | 'unsupported_input'
  | 'protocol'
  | 'busy'
  | 'restarted'
