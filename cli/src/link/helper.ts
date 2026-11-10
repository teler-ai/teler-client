import { ApiError } from '../errors'
import type { LinkApi } from './api'
import { runClaudeTurn } from './claude-turn'
import { runCodexTurn } from './codex-turn'
import { TurnOutbox } from './outbox'
import {
  toolResultSchema,
  turnStartSchema,
  type LinkEngine,
  type LinkEngineInfo,
  type LinkFrame,
  type LinkToolResult,
} from './protocol'

/** Turns this computer runs at once; another one is refused as busy. */
const MAX_TURNS = 2
const ENGINE_REFRESH_MS = 60_000
const CURSOR_TTL_MS = 10 * 60_000

interface ActiveTurn {
  stop: AbortController
  outbox: TurnOutbox
  results: Map<string, (result: LinkToolResult) => void>
  early: Map<string, LinkToolResult>
}

export interface HelperOptions {
  api: Pick<LinkApi, 'poll' | 'postFrames'>
  secret: string
  workDir: string
  detectEngines: () => Promise<LinkEngineInfo[]>
  /** The environment for one engine login (its config folder), or null for an unknown login. */
  accountEnv?: (engine: LinkEngine, account: string) => Promise<NodeJS.ProcessEnv | null>
  log: (line: string) => void
  env?: NodeJS.ProcessEnv
}

const TURN_RUNNERS = { claude_code: runClaudeTurn, codex: runCodexTurn } as const

/** Stops the helper: the pairing was revoked or is no longer valid. */
export class LinkUnpairedError extends Error {}

/**
 * The `teler link` loop: poll Teler for frames, run each turn on the member's engine, and send
 * its frames back. Each turn's frames are read in order, per turn, by their numbers.
 */
export async function runLinkHelper(options: HelperOptions, signal: AbortSignal): Promise<void> {
  const cursors = new Map<string, number>()
  const seenAt = new Map<string, number>()
  const turns = new Map<string, ActiveTurn>()
  let engines = await options.detectEngines()
  let enginesAt = Date.now()
  let unpaired: ApiError | null = null
  let failures = 0
  const unauthorized = (error: ApiError) => {
    unpaired = error
  }

  const startTurn = (frame: LinkFrame, firstSeq: number) => {
    const outbox = new TurnOutbox(options.api, options.secret, frame.taskId, firstSeq, {
      gone: () => turns.get(frame.taskId)?.stop.abort(),
      unauthorized,
    })
    const parsed = turnStartSchema.safeParse(frame.payload)
    const refuse = (error: 'engine_missing' | 'engine_signed_out' | 'protocol' | 'busy') => {
      outbox.emit({ kind: 'turn.done', payload: { status: 'failed', error } })
      void outbox.drain()
    }
    if (!parsed.success) return refuse('protocol')
    const { engine, account } = parsed.data
    if (!engines.some((entry) => entry.engine === engine)) return refuse('engine_missing')
    // An unknown login of the engine is as good as signed out: the member picks another in Teler.
    const login = engines.find((entry) => entry.engine === engine && entry.account === account)
    if (!login?.signedIn) return refuse('engine_signed_out')
    if (turns.size >= MAX_TURNS) return refuse('busy')
    const turn: ActiveTurn = {
      stop: new AbortController(),
      outbox,
      results: new Map(),
      early: new Map(),
    }
    turns.set(frame.taskId, turn)
    options.log('A chat turn started.')
    const run = async () => {
      const env = options.accountEnv
        ? await options.accountEnv(engine, account)
        : (options.env ?? process.env)
      if (!env) {
        outbox.emit({
          kind: 'turn.done',
          payload: { status: 'failed', error: 'engine_signed_out' },
        })
        return
      }
      await TURN_RUNNERS[engine]({
        turn: parsed.data,
        engineVersion: login.version,
        stop: turn.stop.signal,
        workDir: options.workDir,
        env,
        io: {
          emit: (upFrame) => outbox.emit(upFrame),
          awaitToolResult: (callId, stop) =>
            new Promise<LinkToolResult>((resolve, reject) => {
              const early = turn.early.get(callId)
              if (early) return resolve(early)
              turn.results.set(callId, resolve)
              stop.addEventListener('abort', () => reject(new Error('stopped')), { once: true })
            }),
        },
      })
    }
    void run()
      .catch(() =>
        outbox.emit({ kind: 'turn.done', payload: { status: 'failed', error: 'engine_failed' } })
      )
      .then(() => outbox.drain())
      .finally(() => {
        turns.delete(frame.taskId)
        options.log('The chat turn finished.')
      })
  }

  const ended = new Set<string>()
  const endLostTurn = (taskId: string, nextUpSeq: number) => {
    if (ended.has(taskId)) return
    ended.add(taskId)
    const outbox = new TurnOutbox(options.api, options.secret, taskId, nextUpSeq, {
      gone: () => undefined,
      unauthorized,
    })
    outbox.emit({ kind: 'turn.done', payload: { status: 'failed', error: 'restarted' } })
    void outbox.drain()
  }

  const handle = (frame: LinkFrame, nextUpSeq: number) => {
    const turn = turns.get(frame.taskId)
    if (frame.kind === 'turn.start') {
      if (turn || frame.seq !== 0) return
      // Already answered from here before this helper restarted: the engine it ran is gone, so the
      // turn ends instead of running again (and repeating its tool calls).
      if (nextUpSeq > 0) return endLostTurn(frame.taskId, nextUpSeq)
      startTurn(frame, nextUpSeq)
      return
    }
    if (frame.kind === 'turn.stop') {
      turn?.stop.abort()
      return
    }
    if (frame.kind === 'tool.result') {
      const parsed = toolResultSchema.safeParse(frame.payload)
      if (!parsed.success) return turn?.stop.abort()
      if (!turn) {
        // This helper restarted mid-turn: it cannot continue the engine it lost, so it ends it.
        endLostTurn(frame.taskId, nextUpSeq)
        return
      }
      const resolve = turn.results.get(parsed.data.callId)
      if (resolve) {
        turn.results.delete(parsed.data.callId)
        resolve(parsed.data)
      } else turn.early.set(parsed.data.callId, parsed.data)
    }
  }

  while (!signal.aborted) {
    if (unpaired) throw new LinkUnpairedError((unpaired as ApiError).message)
    if (Date.now() - enginesAt > ENGINE_REFRESH_MS && turns.size === 0) {
      engines = await options.detectEngines()
      enginesAt = Date.now()
    }
    try {
      const polled = await options.api.poll(options.secret, {
        engines,
        cursors: [...cursors].map(([taskId, after]) => ({ taskId, after })),
        signal,
      })
      failures = 0
      const now = Date.now()
      for (const frame of polled.frames) {
        const after = cursors.get(frame.taskId)
        // A turn first seen mid-way (this helper restarted) is taken from where it is. A stop
        // counts even past a gap: Teler drops a stopped turn's other frames.
        if (after !== undefined && frame.seq !== after + 1 && frame.kind !== 'turn.stop') continue
        cursors.set(frame.taskId, frame.seq)
        seenAt.set(frame.taskId, now)
        handle(frame, polled.nextUpSeq[frame.taskId] ?? 0)
      }
      // A turn's numbers are forgotten a while after it is over here.
      for (const taskId of [...cursors.keys()]) {
        if (!turns.has(taskId) && now - (seenAt.get(taskId) ?? 0) > CURSOR_TTL_MS) {
          cursors.delete(taskId)
          seenAt.delete(taskId)
        }
      }
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof ApiError && error.status === 401)
        throw new LinkUnpairedError(error.message)
      failures += 1
      if (failures === 3) options.log('Teler is unreachable; retrying.')
      await Bun.sleep(Math.min(1_000 * 2 ** Math.min(failures, 5), 30_000))
    }
  }
  for (const turn of turns.values()) turn.stop.abort()
}
