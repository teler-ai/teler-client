import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { markChatSeen } from './chats'
import { resolveChatId } from './chat-id'
import { assertNoFlags, parseLimit, takeFlag, takeOption } from './command-args'
import { emitJson, resolveOrganizationId } from './command-output'
import { UsageError } from './errors'
import { noticeText, readAttention, watchAttention, writeAttention } from './attention'

const STATUS_USAGE = 'Usage: teler status [--org <id>] [--json]'
const WATCH_USAGE =
  'Usage: teler watch [--org <id>] [--interval <seconds>] [--timeout <seconds>] [--json]'
const RUNS_USAGE =
  'Usage: teler agent runs [--org <id>] [--agent <id>] [--active] [--limit <count>] [--json]'
const NOTIFICATIONS_USAGE =
  'Usage: teler notifications [--org <id>] [--all] [--limit <count>] [--json]'

const DEFAULT_WATCH_INTERVAL_S = 15
const ACTIVE_RUN_STATUSES = new Set(['pending', 'claimed', 'running'])

const agentRunsSchema = z.object({
  runs: z.array(
    z
      .object({
        id: z.string(),
        agentId: z.string().nullable(),
        status: z.string(),
        startedAt: z.string().nullable(),
        completedAt: z.string().nullable(),
        outcome: z.string().nullable().optional(),
        resultSummary: z.string().nullable().optional(),
        createdAt: z.string(),
      })
      .passthrough()
  ),
})

const notificationsSchema = z.object({
  notifications: z.array(
    z
      .object({
        id: z.string(),
        type: z.string(),
        title: z.string(),
        body: z.string().nullable(),
        agentLabel: z.string().nullable().optional(),
        read: z.boolean(),
        createdAt: z.string(),
      })
      .passthrough()
  ),
})

/** The action is part of the arguments for commands that take none (`teler status --org x`). */
function restoreAction(action: string | undefined, args: string[]): void {
  if (action !== undefined) args.unshift(action)
}

function parseSeconds(raw: string | undefined, name: string, fallback: number, max: number) {
  if (raw === undefined) return fallback
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > max)
    throw new UsageError(`${name} must be between 1 and ${max} seconds`)
  return seconds
}

export async function runAttentionCommand(
  group: string | undefined,
  action: string | undefined,
  args: string[],
  client: TelerApiClient,
  output: Output
): Promise<boolean> {
  if (group === 'status') {
    restoreAction(action, args)
    const organizationId = takeOption(args, '--org')
    assertNoFlags(args)
    if (args.length > 0) throw new UsageError(STATUS_USAGE)
    writeAttention(output, await readAttention(client, { organizationId }))
    return true
  }
  if (group === 'watch') {
    restoreAction(action, args)
    const organizationId = takeOption(args, '--org')
    const intervalS = parseSeconds(
      takeOption(args, '--interval'),
      '--interval',
      DEFAULT_WATCH_INTERVAL_S,
      300
    )
    const timeoutRaw = takeOption(args, '--timeout')
    assertNoFlags(args)
    if (args.length > 0) throw new UsageError(WATCH_USAGE)
    const controller = new AbortController()
    const timer =
      timeoutRaw === undefined
        ? null
        : setTimeout(
            () => controller.abort(),
            parseSeconds(timeoutRaw, '--timeout', 0, 86_400) * 1000
          )
    try {
      await watchAttention(client, output, {
        organizationId,
        intervalMs: intervalS * 1000,
        signal: controller.signal,
      })
    } catch (error) {
      // The timeout ends the watch; a read cut short by it is not a failure.
      if (!controller.signal.aborted) throw error
    } finally {
      if (timer) clearTimeout(timer)
    }
    return true
  }
  if (group === 'chat' && action === 'seen') {
    assertNoFlags(args)
    if (args.length !== 1) throw new UsageError('Usage: teler chat seen <chat-id-or-url> [--json]')
    const chatId = resolveChatId(args[0] ?? '')
    const seen = await markChatSeen(client, chatId)
    if (output.json) emitJson(output, seen)
    else output.write(`${chatId} seen at ${seen.lastViewedAt}.\n`)
    return true
  }
  if (group === 'agent' && action === 'runs') {
    const organizationOption = takeOption(args, '--org')
    const agentId = takeOption(args, '--agent')
    const active = takeFlag(args, '--active')
    const limit = parseLimit(takeOption(args, '--limit'), 20, 100)
    assertNoFlags(args)
    if (args.length > 0) throw new UsageError(RUNS_USAGE)
    if (agentId !== undefined && !/^agent_[0-9a-hjkmnp-tv-z]{26}$/.test(agentId))
      throw new UsageError('--agent must be an agent ID')
    const organizationId = await resolveOrganizationId(client, organizationOption)
    const query = new URLSearchParams({ organizationId, limit: String(limit) })
    const { runs } = await client.json(`/api/agent-run?${query}`, agentRunsSchema)
    const selected = runs.filter(
      (run) =>
        (agentId === undefined || run.agentId === agentId) &&
        (!active || ACTIVE_RUN_STATUSES.has(run.status))
    )
    if (output.json) return (emitJson(output, { runs: selected }), true)
    if (selected.length === 0) output.write('No Agent runs found.\n')
    for (const run of selected)
      output.write(
        `${run.id}\t${run.status}\t${run.agentId ?? '-'}\t${run.createdAt}\t${
          run.resultSummary ?? ''
        }\n`
      )
    return true
  }
  if (group === 'notifications') {
    restoreAction(action, args)
    const organizationOption = takeOption(args, '--org')
    const all = takeFlag(args, '--all')
    const limit = parseLimit(takeOption(args, '--limit'), 20, 100)
    assertNoFlags(args)
    if (args.length > 0) throw new UsageError(NOTIFICATIONS_USAGE)
    const organizationId = await resolveOrganizationId(client, organizationOption)
    const query = new URLSearchParams({
      organizationId,
      limit: String(limit),
      onlyUnread: String(!all),
    })
    const { notifications } = await client.json(`/api/notifications?${query}`, notificationsSchema)
    if (output.json) return (emitJson(output, { notifications }), true)
    if (notifications.length === 0)
      output.write(all ? 'No notifications.\n' : 'No unread notifications.\n')
    for (const notification of notifications)
      output.write(
        `${notification.id}\t${notification.read ? 'read' : 'unread'}\t${notification.type}\t${
          notification.createdAt
        }\t${noticeText(notification)}\n`
      )
    return true
  }
  return false
}
