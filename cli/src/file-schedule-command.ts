import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { resolveCliOrganizationId } from './chats'
import { assertNoFlags, takeFlag, takeOption } from './command-args'
import { emitJson } from './command-output'
import {
  codeFileIdSchema,
  fileDescriptorSchema,
  fileScheduleIdSchema,
  fileScheduleRunsSchema,
  fileScheduleSchema,
  spendQuoteSchema,
  type FileSchedule,
  type SpendQuote,
} from './code-file-contract'
import { declarationFor, takeDeclarationFlags } from './code-file-declaration'
import { parseControlInput } from './control-args'
import { CommandError, UsageError } from './errors'
import { creditNano, runSubmitInputSchema } from './run-contract'

const keySchema = runSubmitInputSchema.shape.idempotencyKey
const capSchema = z.string().regex(/^(?:0|[1-9]\d{0,20})(?:\.\d{1,9})?$/)
const revisionSchema = z.number().int().min(1).max(2_147_483_647)
/** A run may hold funds for 1 to 30 minutes. */
const minutesSchema = z.number().int().min(1).max(30)
const timeSchema = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/)
const cadenceSchema = z
  .object({
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
  })
  .refine((value) => value.frequency !== 'weekly' || value.dayOfWeek !== undefined)
  .refine((value) => value.frequency !== 'monthly' || value.dayOfMonth !== undefined)

const path = (id: string, suffix = '') => `/api/schedule/${id}${suffix}`

function scheduleId(args: string[], usage: string): string {
  assertNoFlags(args)
  if (args.length !== 1) throw new UsageError(`Usage: teler schedule file ${usage}`)
  return parseControlInput(fileScheduleIdSchema, args[0], 'schedule ID')
}

async function read(client: TelerApiClient, id: string): Promise<FileSchedule> {
  const schedule = await client.json(path(id), z.unknown())
  const parsed = fileScheduleSchema.safeParse(schedule)
  if (!parsed.success) throw new CommandError('NOT_A_FILE_SCHEDULE', `${id} is not a File schedule`)
  return parsed.data
}

function state(schedule: FileSchedule): string {
  if (schedule.heldByAdmin) return 'held by an admin'
  if (schedule.pauseReason) return `paused (${schedule.pauseReason.kind})`
  if (schedule.isPaused)
    return schedule.needsSpendApproval ? 'paused until its spend is approved' : 'paused'
  return `next run ${schedule.nextRunAt}`
}

function emitSchedule(output: Output, verb: string, schedule: FileSchedule): void {
  if (output.json) emitJson(output, schedule)
  else
    output.write(
      `${verb} ${schedule.id} (revision ${schedule.definitionRevision}): ${state(schedule)}\n`
    )
}

function emitQuote(
  output: Output,
  id: string,
  quote: SpendQuote,
  maxRunMillis: number | undefined
): void {
  if (output.json) return emitJson(output, quote)
  const runTime = maxRunMillis === undefined ? '' : ` --max-run-minutes ${maxRunMillis / 60_000}`
  output.write(
    `${id} revision ${quote.definitionRevision}: up to ${quote.maximumCreditsPerOccurrence} credits a run ` +
      `(runs up to ${Math.ceil(quote.maxRunMillis / 1000)} s), about ${quote.expectedOccurrencesPerMonth} runs a month ` +
      `(at most ${quote.worstCaseOccurrencesPerMonth}); suggested cap ${quote.suggestedMaximumCreditsPerMonth} ` +
      `credits a month; ${quote.monthToDateCredits} spent this month; approval lasts until ${quote.expiresAt}\n` +
      `Approve: teler schedule file approve ${id} --revision ${quote.definitionRevision} ` +
      `--monthly-credits ${quote.suggestedMaximumCreditsPerMonth}${runTime} --yes\n`
  )
}

function takeMinutes(args: string[]): number | undefined {
  const minutes = takeOption(args, '--max-run-minutes')
  return minutes === undefined
    ? undefined
    : parseControlInput(minutesSchema, Number(minutes), '--max-run-minutes') * 60_000
}

async function quoteOf(client: TelerApiClient, id: string, maxRunMillis: number | undefined) {
  return await client.json(path(id, '/spend/prepare'), spendQuoteSchema, {
    method: 'POST',
    body: JSON.stringify(maxRunMillis === undefined ? {} : { maxRunMillis }),
  })
}

async function create(client: TelerApiClient, output: Output, args: string[]) {
  const organizationOption = takeOption(args, '--org')
  const key = takeOption(args, '--idempotency-key')
  const timeUtc = takeOption(args, '--time-utc')
  const time = takeOption(args, '--time')
  const timezone = takeOption(args, '--timezone')
  const dayOfWeek = takeOption(args, '--day-of-week')
  const dayOfMonth = takeOption(args, '--day-of-month')
  const cadence = parseControlInput(
    cadenceSchema,
    {
      frequency: takeOption(args, '--frequency'),
      dayOfWeek: dayOfWeek === undefined ? undefined : Number(dayOfWeek),
      dayOfMonth: dayOfMonth === undefined ? undefined : Number(dayOfMonth),
    },
    'schedule cadence; use daily, weekly with --day-of-week, or monthly with --day-of-month'
  )
  const flags = takeDeclarationFlags(args)
  assertNoFlags(args)
  if (
    args.length !== 1 ||
    (timeUtc === undefined) === (time === undefined) ||
    (timeUtc === undefined) === (timezone === undefined)
  )
    throw new UsageError(
      'Usage: teler schedule file create <file-id> --frequency <cadence> (--time-utc <HH:MM> | --time <HH:MM> --timezone <zone>) --idempotency-key <key>'
    )
  const fileId = parseControlInput(codeFileIdSchema, args[0], 'File ID')
  const operationKey = parseControlInput(keySchema, key, '--idempotency-key')
  const at =
    timeUtc !== undefined
      ? { timeUtc: parseControlInput(timeSchema, timeUtc, '--time-utc') }
      : { time: parseControlInput(timeSchema, time, '--time'), timezone }
  const organizationId = await resolveCliOrganizationId(client, organizationOption)
  const query = new URLSearchParams({ organizationId })
  const descriptor = await client.json(
    `/api/files/${fileId}/content-descriptor?${query}`,
    fileDescriptorSchema
  )
  if (descriptor.revisionId === null)
    throw new CommandError('NOT_A_CODE_FILE', `${fileId} is not a saved code File`)
  const { projectId, ...target } = await declarationFor(
    client,
    organizationId,
    fileId,
    flags,
    'schedule'
  )
  const schedule = await client.json('/api/schedule/files', fileScheduleSchema, {
    method: 'POST',
    body: JSON.stringify({
      organizationId,
      projectId,
      operationKey,
      ...cadence,
      ...at,
      target: { fileId, revisionId: descriptor.revisionId, ...target },
    }),
  })
  emitSchedule(output, 'Created', schedule)
  if (!output.json) output.write(`Next: teler schedule file quote ${schedule.id}\n`)
}

async function approve(client: TelerApiClient, output: Output, args: string[]) {
  const revision = takeOption(args, '--revision')
  const cap = takeOption(args, '--monthly-credits')
  const confirmed = takeFlag(args, '--yes')
  const maxRunMillis = takeMinutes(args)
  const id = scheduleId(args, 'approve <id> --revision <n> --monthly-credits <amount> --yes')
  const expectedRevision = parseControlInput(revisionSchema, Number(revision), '--revision')
  const monthly = parseControlInput(capSchema, cap, '--monthly-credits')
  if (!confirmed)
    throw new UsageError(
      `Approving spend requires --yes; read the quote first with \`teler schedule file quote ${id}\``
    )
  const quote = await quoteOf(client, id, maxRunMillis)
  if (quote.definitionRevision !== expectedRevision) {
    // An approval whose answer was lost moved the revision exactly one on: report it and
    // approve nothing new. Any other move (a pause, a hold) makes the live approval another one.
    const current = await read(client, id)
    if (
      current.definitionRevision === expectedRevision + 1 &&
      sameApproval(current, monthly, maxRunMillis)
    ) {
      if (output.json) return emitJson(output, current)
      return output.write(`${id} is already approved: ${spendWords(current)}\n`)
    }
    throw new CommandError(
      'STALE_QUOTE',
      `${id} is at revision ${quote.definitionRevision}, not ${expectedRevision}`,
      `Run \`teler schedule file quote ${id}\` again and approve the revision it shows.`
    )
  }
  if (creditNano(monthly) < creditNano(quote.maximumCreditsPerOccurrence))
    throw new UsageError(
      `--monthly-credits must be at least one run's hold, ${quote.maximumCreditsPerOccurrence} credits`
    )
  // The same approval sent again before it took effect is the same operation, so it replays.
  const operationKey = `cli-approve-${createHash('sha256')
    .update(JSON.stringify([id, expectedRevision, monthly, quote.maxRunMillis, quote.configSha256]))
    .digest('hex')}`
  const schedule = await client.json(path(id, '/spend/approve'), fileScheduleSchema, {
    method: 'POST',
    body: JSON.stringify({
      operationKey,
      expectedRevision,
      maxRunMillis: quote.maxRunMillis,
      maximumCreditsPerOccurrence: quote.maximumCreditsPerOccurrence,
      maximumCreditsPerMonth: monthly,
      personalFallback: null,
      tariffVersion: quote.tariffVersion,
      configSha256: quote.configSha256,
      computeIncluded: quote.computeIncluded,
    }),
  })
  if (output.json) return emitJson(output, schedule)
  output.write(`Approved ${schedule.id}: ${spendWords(schedule)}\n`)
}

/** Its live approval already has this monthly cap (and run time, when one was asked for). */
function sameApproval(schedule: FileSchedule, monthly: string, maxRunMillis: number | undefined) {
  const spend = schedule.spend
  return (
    spend !== null &&
    spend.status === 'active' &&
    creditNano(spend.maximumCreditsPerMonth) === creditNano(monthly) &&
    (maxRunMillis === undefined || spend.maxRunMillis === maxRunMillis)
  )
}

function spendWords(schedule: FileSchedule): string {
  const spend = schedule.spend
  const terms =
    spend === null || spend.status !== 'active'
      ? 'no spend in force'
      : `up to ${spend.maximumCreditsPerOccurrence} credits a run and ` +
        `${spend.maximumCreditsPerMonth} a month, until ${spend.expiresAt}`
  return `${terms}; ${state(schedule)}`
}

/** `teler schedule file …`: a saved code File run on a schedule, and its approved spend. */
export async function runFileScheduleCommand(
  client: TelerApiClient,
  output: Output,
  action: string | undefined,
  args: string[]
): Promise<void> {
  if (action === 'create') return await create(client, output, args)
  if (action === 'approve') return await approve(client, output, args)
  if (action === 'quote') {
    const maxRunMillis = takeMinutes(args)
    const id = scheduleId(args, 'quote <id> [--max-run-minutes <minutes>]')
    return emitQuote(output, id, await quoteOf(client, id, maxRunMillis), maxRunMillis)
  }
  if (action === 'show')
    return emitSchedule(output, 'File schedule', await read(client, scheduleId(args, 'show <id>')))
  if (action === 'runs') {
    const id = scheduleId(args, 'runs <id>')
    const { runs } = await client.json(path(id, '/history'), fileScheduleRunsSchema)
    if (output.json) return emitJson(output, { runs })
    if (!runs.length) return output.write('No scheduled runs yet.\n')
    for (const run of runs)
      output.write(
        `${run.scheduledFor}\t${run.status}\t${run.savedCodeRunId ?? 'no run'}\t` +
          `${run.savedCodeRunStatus ?? run.reason ?? ''}\n`
      )
    return
  }
  if (action === 'pause' || action === 'resume' || action === 're-pin' || action === 'delete') {
    const confirmed = action === 'delete' && takeFlag(args, '--yes')
    const id = scheduleId(args, `${action} <id>${action === 'delete' ? ' --yes' : ''}`)
    if (action === 'delete' && !confirmed) throw new UsageError('Schedule delete requires --yes')
    // Each change names the revision just read: a change made meanwhile is refused, not overwritten.
    const { definitionRevision: expectedRevision } = await read(client, id)
    if (action === 'delete') {
      await client.request(path(id, `?expectedRevision=${expectedRevision}`), { method: 'DELETE' })
      if (output.json) emitJson(output, { deleted: true, id })
      else output.write(`Deleted ${id}\n`)
      return
    }
    const schedule = await client.json(
      path(id, action === 're-pin' ? '/file/re-pin' : ''),
      fileScheduleSchema,
      action === 're-pin'
        ? { method: 'POST', body: JSON.stringify({ expectedRevision }) }
        : {
            method: 'PATCH',
            body: JSON.stringify({ isPaused: action === 'pause', expectedRevision }),
          }
    )
    emitSchedule(output, action === 're-pin' ? 'Moved' : 'Updated', schedule)
    if (!output.json && action === 're-pin' && schedule.needsSpendApproval)
      output.write(
        `It runs version ${schedule.revisionId} once you approve its spend: teler schedule file quote ${id}\n`
      )
    return
  }
  throw new UsageError(
    'Unknown schedule file command. Use create, show, quote, approve, pause, resume, re-pin, runs or delete.'
  )
}
