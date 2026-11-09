import type { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { assertNoFlags, takeFlag, takeOption } from './command-args'
import { emitJson, resolveOrganizationId } from './command-output'
import { parseControlInput } from './control-args'
import { takeApprovedCapabilities, withApprovalGuidance } from './capability-approval'
import { UsageError } from './errors'
import { runFileScheduleCommand } from './file-schedule-command'
import {
  createScheduleSchema,
  eventStartSchema,
  scheduleDefinitionSchema,
  scheduleHistorySchema,
  scheduleIdSchema,
  scheduleListSchema,
  scheduleSchema,
  updateScheduleSchema,
} from './schedule-contract'

type ScheduleDefinition = z.infer<typeof scheduleDefinitionSchema>

/** Why a table start can't start as it is, in words; null while its table exists. */
function tableGoneWords(gone: string | null | undefined): string | null {
  if (gone === 'deleted') return "won't run: its table was deleted. Choose a table again"
  if (gone === 'replaced') return 'waiting for the replaced file to finish loading'
  return gone ? 'its table is unavailable (update teler to see more)' : null
}

/** "next run <time>" for a time schedule; an event start has none, so it says what starts it. */
function startWords(definition: ScheduleDefinition): string {
  if (!('startKind' in definition)) return `next run ${definition.nextRunAt}`
  const parsed = eventStartSchema.safeParse(definition)
  if (!parsed.success) return `starts on ${definition.startKind} (update teler to see more)`
  const start = parsed.data
  if (start.startKind === 'table_update') {
    return tableGoneWords(start.startTable?.gone) ?? 'starts when its table updates'
  }
  if (start.startKind === 'agent_finished') return 'starts when another Agent finishes'
  const alert = start.startAlert
  return alert
    ? `starts when an alert opens on the ${alert.kind === 'agent' ? 'Agent' : 'File'} ${alert.label ?? alert.id}`
    : 'starts when an alert opens'
}

/**
 * "paused", or what starts it. A paused start whose table is gone still says so: resuming it
 * alone won't make it run.
 */
function stateWords(definition: ScheduleDefinition): string {
  if (!definition.isPaused) return startWords(definition)
  const parsed = eventStartSchema.safeParse(definition)
  const gone = parsed.success ? tableGoneWords(parsed.data.startTable?.gone) : null
  return gone ? `paused · ${gone}` : 'paused'
}

const SCHEDULE_APPROVAL = {
  required: ['SCHEDULE_APPROVAL_REQUIRED', 'This Agent needs your approval to run on schedule'],
  denied: ['SCHEDULE_CAPABILITY_DENIED', 'Your Agent Access settings deny what this Agent needs'],
} as const

function definitionOptions(args: string[]) {
  const dayOfWeek = takeOption(args, '--day-of-week')
  const dayOfMonth = takeOption(args, '--day-of-month')
  const prompt = takeOption(args, '--prompt')
  const clearPrompt = takeFlag(args, '--clear-prompt')
  if (prompt !== undefined && clearPrompt) throw new UsageError('Use --prompt or --clear-prompt')
  return {
    projectId: takeOption(args, '--project'),
    frequency: takeOption(args, '--frequency'),
    timeUtc: takeOption(args, '--time-utc'),
    dayOfWeek: dayOfWeek === undefined ? undefined : Number(dayOfWeek),
    dayOfMonth: dayOfMonth === undefined ? undefined : Number(dayOfMonth),
    prompt: clearPrompt ? null : prompt,
    deliveryMethod: takeOption(args, '--delivery'),
  }
}

export async function runScheduleCommand(
  client: TelerApiClient,
  output: Output,
  action: string | undefined,
  args: string[]
): Promise<void> {
  if (action === 'file') return await runFileScheduleCommand(client, output, args.shift(), args)
  if (action === 'create') {
    const input = parseControlInput(
      createScheduleSchema,
      {
        ...definitionOptions(args),
        agentId: takeOption(args, '--agent'),
        organizationId: takeOption(args, '--org'),
        approvedCapabilities: takeApprovedCapabilities(args),
      },
      'schedule create options; use daily, weekly with --day-of-week, or monthly with --day-of-month'
    )
    assertNoFlags(args)
    if (args.length)
      throw new UsageError(
        'Usage: teler schedule create --agent <id> --frequency <cadence> --time-utc <HH:MM> [options]'
      )
    const organizationId = await resolveOrganizationId(client, input.organizationId)
    const result = await withApprovalGuidance(
      { ...SCHEDULE_APPROVAL, command: 'teler schedule create' },
      () =>
        client.json('/api/schedule', scheduleSchema, {
          method: 'POST',
          body: JSON.stringify({ ...input, organizationId }),
        })
    )
    if (output.json) emitJson(output, result)
    else output.write(`Created ${result.id}: next run ${result.nextRunAt}\n`)
    return
  }
  if (action === 'list') {
    const organizationIdOption = takeOption(args, '--org')
    assertNoFlags(args)
    if (args.length) throw new UsageError('Usage: teler schedule list [--org <id>]')
    const organizationId = await resolveOrganizationId(client, organizationIdOption)
    const query = new URLSearchParams({ organizationId })
    const result = await client.json(`/api/schedule?${query.toString()}`, scheduleListSchema)
    if (output.json) emitJson(output, result)
    else if (
      result.schedules.length === 0 &&
      result.eventStarts.length === 0 &&
      result.fileSchedules.length === 0
    )
      output.write('No schedules found.\n')
    else {
      for (const schedule of result.schedules) {
        output.write(
          `${schedule.id}\t${schedule.frequency}\t${schedule.isPaused ? 'paused' : schedule.nextRunAt}\n`
        )
      }
      for (const start of result.eventStarts) {
        output.write(`${start.id}\t${start.startKind}\t${stateWords(start)}\n`)
      }
      for (const file of result.fileSchedules) {
        output.write(
          `${file.id}\tfile ${file.fileId}\t${file.isPaused ? 'paused' : file.nextRunAt}\n`
        )
      }
    }
    return
  }
  if (action === 'update' || action === 'pause' || action === 'resume') {
    const input =
      action === 'update'
        ? parseControlInput(
            updateScheduleSchema,
            definitionOptions(args),
            'schedule update options'
          )
        : { isPaused: action === 'pause' }
    assertNoFlags(args)
    if (args.length !== 1) throw new UsageError(`Usage: teler schedule ${action} <id> [options]`)
    const id = parseControlInput(scheduleIdSchema, args[0], 'schedule ID')
    const result = await client.json(`/api/schedule/${id}`, scheduleDefinitionSchema, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    if (output.json) emitJson(output, result)
    else output.write(`Updated ${result.id}: ${stateWords(result)}\n`)
    return
  }
  if (action === 'approve') {
    const approved = takeApprovedCapabilities(args)
    assertNoFlags(args)
    if (args.length !== 1) {
      throw new UsageError('Usage: teler schedule approve <id> [--approve <capability,...>]')
    }
    const id = parseControlInput(scheduleIdSchema, args[0], 'schedule ID')
    const result = await withApprovalGuidance(
      { ...SCHEDULE_APPROVAL, command: 'teler schedule approve' },
      () =>
        client.json(`/api/schedule/${id}/approve`, scheduleDefinitionSchema, {
          method: 'POST',
          body: JSON.stringify({ approvedCapabilities: approved ?? [] }),
        })
    )
    if (output.json) emitJson(output, result)
    else output.write(`Approved ${result.id}: ${startWords(result)}\n`)
    return
  }
  if (action === 'history') {
    assertNoFlags(args)
    if (args.length !== 1) throw new UsageError('Usage: teler schedule history <id>')
    const id = parseControlInput(scheduleIdSchema, args[0], 'schedule ID')
    const result = await client.json(`/api/schedule/${id}/history`, scheduleHistorySchema)
    if (output.json) emitJson(output, result)
    else if (!result.runs.length) output.write('No scheduled runs found.\n')
    else
      // A skipped row, or a run that started but didn't finish, ends with why in words.
      for (const run of result.runs) {
        output.write(
          `${run.id}\t${run.scheduledFor}\t${run.status}\t${run.agentRunStatus ?? 'no Agent run'}\t${run.taskId ?? 'no task'}${run.reasonText ? `\t${run.reasonText}` : ''}\n`
        )
      }
    return
  }
  if (action === 'delete') {
    const confirmed = takeFlag(args, '--yes')
    assertNoFlags(args)
    if (!confirmed) throw new UsageError('Schedule delete requires --yes')
    if (args.length !== 1) throw new UsageError('Usage: teler schedule delete <id> --yes')
    const id = parseControlInput(scheduleIdSchema, args[0], 'schedule ID')
    await client.request(`/api/schedule/${id}`, { method: 'DELETE' })
    if (output.json) emitJson(output, { deleted: true, id })
    else output.write(`Deleted ${id}\n`)
    return
  }
  throw new UsageError(
    'Unknown schedule command. Use create, list, update, pause, resume, approve, history, delete or file.'
  )
}
