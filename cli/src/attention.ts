import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'

/**
 * `GET /api/attention`: what of the signed-in person's own work runs and what waits for them.
 * `cursor` is the server's clock at the read; a read with `since` set to an earlier cursor also
 * lists what finished and which notices arrived after it, overlapping the cursor so a late
 * write is not lost. Readers therefore dedupe by id (`AttentionTracker`).
 */

const idPattern = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[0-9a-hjkmnp-tv-z]{26}$`))
const runningStatusSchema = z.enum(['pending', 'claimed', 'running'])
const finishedStatusSchema = z.enum(['completed', 'failed', 'cancelled'])

const chatFields = {
  id: idPattern('chat'),
  title: z.string().nullable(),
  organizationId: z.string().nullable(),
  projectId: z.string().nullable(),
}
export const runningChatSchema = z
  .object({
    ...chatFields,
    taskId: z.string(),
    status: runningStatusSchema,
    startedAt: z.string().nullable(),
  })
  .passthrough()
export const finishedChatSchema = z
  .object({
    ...chatFields,
    taskId: z.string(),
    status: finishedStatusSchema,
    completedAt: z.string(),
  })
  .passthrough()

const agentRunFields = {
  id: z.string(),
  agentId: z.string().nullable(),
  agentLabel: z.string().nullable(),
  organizationId: z.string(),
}
export const runningAgentRunSchema = z
  .object({
    ...agentRunFields,
    status: runningStatusSchema,
    startedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .passthrough()
export const finishedAgentRunSchema = z
  .object({
    ...agentRunFields,
    status: finishedStatusSchema,
    outcome: z.string().nullable(),
    completedAt: z.string(),
  })
  .passthrough()

export const attentionNotificationSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    type: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    agentLabel: z.string().nullable(),
    createdAt: z.string(),
    /** A path on the Teler origin a click opens; null when the notice has no page of its own. */
    targetPath: z
      .string()
      .max(2048)
      .refine((path) => path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'))
      .nullable(),
  })
  .passthrough()

export const attentionSchema = z
  .object({
    cursor: z.string(),
    running: z.object({
      chats: z.array(runningChatSchema),
      agentRuns: z.array(runningAgentRunSchema),
    }),
    /** Chats whose last turn finished after the person last looked at them. */
    waiting: z.object({ chats: z.array(finishedChatSchema) }),
    unreadNotifications: z.array(
      z.object({ organizationId: z.string(), count: z.number().int().nonnegative() })
    ),
    /** Since the `since` cursor; empty without one. */
    finished: z.object({
      chats: z.array(finishedChatSchema),
      agentRuns: z.array(finishedAgentRunSchema),
    }),
    notifications: z.array(attentionNotificationSchema),
  })
  .passthrough()

export type Attention = z.infer<typeof attentionSchema>
export type RunningChat = z.infer<typeof runningChatSchema>
export type FinishedChat = z.infer<typeof finishedChatSchema>
export type RunningAgentRun = z.infer<typeof runningAgentRunSchema>
export type FinishedAgentRun = z.infer<typeof finishedAgentRunSchema>
export type AttentionNotification = z.infer<typeof attentionNotificationSchema>

export interface AttentionReadOptions {
  organizationId?: string
  since?: string
  signal?: AbortSignal
}

export function attentionPath(options: Pick<AttentionReadOptions, 'organizationId' | 'since'>) {
  const query = new URLSearchParams()
  if (options.organizationId) query.set('organizationId', options.organizationId)
  if (options.since) query.set('since', options.since)
  const search = query.toString()
  return `/api/attention${search ? `?${search}` : ''}`
}

export async function readAttention(
  client: TelerApiClient,
  options: AttentionReadOptions = {}
): Promise<Attention> {
  return client.json(attentionPath(options), attentionSchema, { signal: options.signal })
}

export function isAttentionActive(attention: Attention): boolean {
  return attention.running.chats.length > 0 || attention.running.agentRuns.length > 0
}

export function unreadTotal(attention: Attention): number {
  return attention.unreadNotifications.reduce((total, item) => total + item.count, 0)
}

export type AttentionEvent =
  | { type: 'chat.started'; data: RunningChat }
  | { type: 'chat.finished'; data: FinishedChat }
  | { type: 'agent_run.started'; data: RunningAgentRun }
  | { type: 'agent_run.finished'; data: FinishedAgentRun }
  | { type: 'notification'; data: AttentionNotification }

/** Ids remembered, so an id seen again after the overlap is still recognized. */
const ANNOUNCED_MAX = 2_000

/**
 * Turns consecutive reads into events. The first read is a baseline that announces nothing;
 * afterwards a turn or run is announced once when it starts (if a read sees it running) and
 * once when it finishes, and a notice once, however the reads overlap.
 */
export class AttentionTracker {
  private runningTasks = new Set<string>()
  private runningRuns = new Set<string>()
  private readonly announced = new Set<string>()
  private baseline = true
  /** The last read's cursor, to pass as `since` to the next read. */
  cursor: string | null = null

  next(attention: Attention): AttentionEvent[] {
    const events: AttentionEvent[] = []
    const announce = (key: string): boolean => {
      if (this.announced.has(key)) return false
      this.announced.add(key)
      return true
    }
    if (!this.baseline) {
      for (const chat of attention.running.chats)
        if (!this.runningTasks.has(chat.taskId) && announce(`start:${chat.taskId}`))
          events.push({ type: 'chat.started', data: chat })
      for (const run of attention.running.agentRuns)
        if (!this.runningRuns.has(run.id) && announce(`start:${run.id}`))
          events.push({ type: 'agent_run.started', data: run })
      for (const chat of attention.finished.chats)
        if (announce(`end:${chat.taskId}`)) events.push({ type: 'chat.finished', data: chat })
      for (const run of attention.finished.agentRuns)
        if (announce(`end:${run.id}`)) events.push({ type: 'agent_run.finished', data: run })
      for (const notification of attention.notifications)
        if (announce(`notice:${notification.id}`))
          events.push({ type: 'notification', data: notification })
    }
    this.runningTasks = new Set(attention.running.chats.map((chat) => chat.taskId))
    this.runningRuns = new Set(attention.running.agentRuns.map((run) => run.id))
    this.cursor = attention.cursor
    this.baseline = false
    while (this.announced.size > ANNOUNCED_MAX) {
      const oldest = this.announced.values().next().value
      if (oldest === undefined) break
      this.announced.delete(oldest)
    }
    return events
  }
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** One line: what runs and what waits, for people. */
export function summarizeAttention(attention: Attention): string {
  const running = [
    attention.running.chats.length > 0 && count(attention.running.chats.length, 'chat', 'chats'),
    attention.running.agentRuns.length > 0 &&
      count(attention.running.agentRuns.length, 'Agent', 'Agents'),
  ].filter((part): part is string => Boolean(part))
  const unread = unreadTotal(attention)
  const waiting = [
    attention.waiting.chats.length > 0 && count(attention.waiting.chats.length, 'chat', 'chats'),
    unread > 0 && count(unread, 'notification', 'notifications'),
  ].filter((part): part is string => Boolean(part))
  return `${running.length > 0 ? `${running.join(' and ')} running` : 'Nothing running'}; ${
    waiting.length > 0 ? `${waiting.join(' and ')} waiting for you` : 'nothing waiting for you'
  }.`
}

export function writeAttention(output: Output, attention: Attention): void {
  if (output.json) {
    output.write(`${JSON.stringify(attention)}\n`)
    return
  }
  output.write(`${summarizeAttention(attention)}\n`)
  for (const chat of attention.running.chats)
    output.write(`running\tchat\t${chat.id}\t${chat.status}\t${chat.title ?? 'Untitled'}\n`)
  for (const run of attention.running.agentRuns)
    output.write(
      `running\tagent\t${run.id}\t${run.status}\t${run.agentLabel ?? run.agentId ?? ''}\n`
    )
  for (const chat of attention.waiting.chats)
    output.write(`waiting\tchat\t${chat.id}\t${chat.status}\t${chat.title ?? 'Untitled'}\n`)
  for (const item of attention.unreadNotifications)
    if (item.count > 0) output.write(`unread\t${item.organizationId}\t${item.count}\n`)
}

function eventLine(event: AttentionEvent): string {
  switch (event.type) {
    case 'chat.started':
    case 'chat.finished':
      return `${event.type}\t${event.data.id}\t${event.data.status}\t${event.data.title ?? 'Untitled'}`
    case 'agent_run.started':
    case 'agent_run.finished':
      return `${event.type}\t${event.data.id}\t${event.data.status}\t${
        event.data.agentLabel ?? event.data.agentId ?? ''
      }`
    case 'notification':
      return `${event.type}\t${event.data.id}\t${event.data.type}\t${event.data.title}`
  }
}

export function writeAttentionEvent(output: Output, event: AttentionEvent, at = new Date()): void {
  if (output.json) output.write(`${JSON.stringify(event)}\n`)
  else output.write(`${at.toISOString().slice(11, 19)}\t${eventLine(event)}\n`)
}

/** While something runs, reads come at least this often. */
export const WATCH_ACTIVE_MS = 5_000

export interface WatchAttentionOptions {
  organizationId?: string
  intervalMs: number
  /** Ends the watch, normally: a `--timeout` or Ctrl-C. */
  signal?: AbortSignal
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  now?: () => Date
}

function sleepUntilAbort(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', finish)
      resolve()
    }, milliseconds)
    const finish = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })
}

/**
 * `teler watch`: the status once, then one line (or NDJSON record) per turn, run or notice that
 * starts or ends, until the signal aborts. Reads every `intervalMs`, or every 5 s while
 * something runs.
 */
export async function watchAttention(
  client: TelerApiClient,
  output: Output,
  options: WatchAttentionOptions
): Promise<void> {
  const sleep = options.sleep ?? sleepUntilAbort
  const now = options.now ?? (() => new Date())
  const tracker = new AttentionTracker()
  while (!options.signal?.aborted) {
    const attention = await readAttention(client, {
      organizationId: options.organizationId,
      since: tracker.cursor ?? undefined,
      signal: options.signal,
    })
    const first = tracker.cursor === null
    const events = tracker.next(attention)
    if (first) {
      if (output.json) output.write(`${JSON.stringify({ type: 'status', data: attention })}\n`)
      else output.write(`${summarizeAttention(attention)}\n`)
    }
    for (const event of events) writeAttentionEvent(output, event, now())
    await sleep(
      isAttentionActive(attention)
        ? Math.min(WATCH_ACTIVE_MS, options.intervalMs)
        : options.intervalMs,
      options.signal
    )
  }
}
