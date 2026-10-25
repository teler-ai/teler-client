import { z } from 'zod'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { runAgentAccessCommand } from './agent-access-command'
import { takeApprovedCapabilities, withApprovalGuidance } from './capability-approval'
import { assertNoFlags, takeFlag, takeOption } from './command-args'
import { emitJson } from './command-output'
import { parseControlInput } from './control-args'
import { UsageError } from './errors'

const suffix = '[0-9a-hjkmnp-tv-z]{26}'
const typedId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_${suffix}$`))
const agentIdSchema = typedId('agent')
const runIdSchema = typedId('agent_run')
const capabilitySchema = z.string().regex(/^[a-z]+(?:\.[a-z]+)+$/)
/** A code the server gives for a run that did not start; anything else is not printed. */
const reasonCode = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)

const runInputSchema = z.object({
  prompt: z.string().min(1).max(4000).optional(),
  projectId: typedId('prj').optional(),
  approvedCapabilities: z.array(capabilitySchema).max(64).optional(),
})
const startedSchema = z.object({
  runId: runIdSchema,
  chatId: typedId('chat'),
  agentTaskId: typedId('atask'),
})
const spendCapSchema = z.object({
  agentId: agentIdSchema,
  spendCapCreditsPerMonth: z.number().int().positive().nullable(),
  approvedThisMonthCredits: z
    .string()
    .regex(/^\d{1,30}(?:\.\d{1,9})?$/)
    .optional(),
})
const capSchema = z.number().int().min(1).max(1_000_000)
const rerunSchema = z.object({
  runId: runIdSchema.nullable(),
  allowed: z.array(capabilitySchema),
  reason: z.string().optional(),
})
const appliedSchema = z.object({
  status: z.literal('applied'),
  label: z.string(),
  emailOwner: z.boolean(),
  colleagueNames: z.array(z.string()),
})
/** A run lists at most 20 skipped actions; one is named by its place in that list. */
const positionSchema = z.string().regex(/^1?[0-9]$/)
const keySchema = z.string().regex(/^[a-zA-Z0-9._:-]{16,128}$/)

function oneId<T>(args: string[], schema: z.ZodType<T>, usage: string, label: string): T {
  assertNoFlags(args)
  if (args.length !== 1) throw new UsageError(`Usage: teler agent ${usage}`)
  return parseControlInput(schema, args[0], label)
}

/** `teler agent run`: start an Agent now, as Run now in the app does. */
async function run(client: TelerApiClient, output: Output, args: string[]) {
  const prompt = takeOption(args, '--prompt')
  const projectId = takeOption(args, '--project')
  const key = takeOption(args, '--idempotency-key')
  const approvedCapabilities = takeApprovedCapabilities(args)
  const usage =
    'run <agent-id> --idempotency-key <key> [--prompt <text>] [--project <id>] [--approve <capability,...>]'
  const agentId = oneId(args, agentIdSchema, usage, 'Agent ID')
  // A run costs credits: the same key sent again after a lost answer starts nothing new.
  const idempotencyKey = parseControlInput(
    keySchema,
    key,
    '--idempotency-key; use 16 to 128 letters, digits, ".", "_", ":" or "-"'
  )
  const input = parseControlInput(
    runInputSchema,
    { prompt, projectId, approvedCapabilities },
    'agent run options'
  )
  const started = await withApprovalGuidance(
    {
      command: `teler agent run ${agentId}`,
      required: ['AGENT_CAPABILITY_APPROVAL_REQUIRED', 'This Agent needs your approval to run'],
      denied: ['AGENT_CAPABILITY_DENIED', 'Your Agent Access settings deny what this Agent needs'],
    },
    () =>
      client.json(`/api/agent/${agentId}/run`, startedSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(input),
      })
  )
  if (output.json) return emitJson(output, started)
  output.write(
    `Started ${started.runId}. Follow it: teler agent runs --agent ${agentId} --active\n`
  )
}

function capWords(agentId: string, cap: number | null): string {
  return cap === null
    ? `${agentId} approves no File schedule spend for you`
    : `${agentId} may approve up to ${cap} credits a month of File schedule spend for you`
}

/** `teler agent spend-cap`: what an Agent may approve of its owner's File schedule spend. */
async function spendCap(client: TelerApiClient, output: Output, args: string[]) {
  const monthly = takeOption(args, '--monthly-credits')
  const none = takeFlag(args, '--none')
  const confirmed = takeFlag(args, '--yes')
  const usage = 'spend-cap <agent-id> [--monthly-credits <1-1000000> --yes | --none]'
  const agentId = oneId(args, agentIdSchema, usage, 'Agent ID')
  if (monthly !== undefined && none) throw new UsageError('Use --monthly-credits or --none')
  // Raising the cap lets the Agent approve spend for you, as approving a File schedule does.
  if (monthly !== undefined && !confirmed)
    throw new UsageError('Setting a spend cap lets this Agent approve spend for you; pass --yes')
  const path = `/api/agent/${agentId}/spend-cap`
  if (monthly === undefined && !none) {
    const read = await client.json(path, spendCapSchema)
    if (output.json) return emitJson(output, read)
    return output.write(
      `${capWords(agentId, read.spendCapCreditsPerMonth)}; ${read.approvedThisMonthCredits ?? '0'} approved this month\n`
    )
  }
  const creditsPerMonth = none
    ? null
    : parseControlInput(capSchema, Number(monthly), '--monthly-credits')
  const saved = await client.json(path, spendCapSchema, {
    method: 'PUT',
    body: JSON.stringify({ creditsPerMonth }),
  })
  if (output.json) return emitJson(output, saved)
  output.write(`${capWords(agentId, saved.spendCapCreditsPerMonth)}\n`)
}

/** `teler agent allow-and-rerun`: allow what a scheduled run skipped, and run it again now. */
async function allowAndRerun(client: TelerApiClient, output: Output, args: string[]) {
  const listed = takeOption(args, '--capabilities')
  const usage = 'allow-and-rerun <run-id> [--capabilities <capability,...>]'
  const runId = oneId(args, runIdSchema, usage, 'run ID')
  const capabilities =
    listed === undefined
      ? undefined
      : parseControlInput(
          z.array(capabilitySchema).min(1).max(64),
          listed.split(',').map((capability) => capability.trim()),
          '--capabilities'
        )
  const result = await client.json(`/api/agent-run/${runId}/allow-and-rerun`, rerunSchema, {
    method: 'POST',
    body: JSON.stringify(capabilities === undefined ? {} : { capabilities }),
  })
  if (output.json) return emitJson(output, result)
  const allowed = `Allowed ${result.allowed.join(', ')} for this schedule's runs`
  if (result.runId) return output.write(`${allowed}; started ${result.runId}\n`)
  const reason = reasonCode.safeParse(result.reason).data
  output.write(`${allowed}; the run did not start now${reason ? ` (${reason})` : ''}\n`)
}

/** `teler agent apply-skipped`: apply the change a run kept for its owner (alert recipients). */
async function applySkipped(client: TelerApiClient, output: Output, args: string[]) {
  assertNoFlags(args)
  if (args.length !== 2) throw new UsageError('Usage: teler agent apply-skipped <run-id> <n>')
  const runId = parseControlInput(runIdSchema, args[0], 'run ID')
  const position = parseControlInput(positionSchema, args[1], 'skipped action; use 0 to 19')
  const applied = await client.json(
    `/api/agent-run/${runId}/skipped-actions/${position}/apply`,
    appliedSchema,
    { method: 'POST' }
  )
  if (output.json) return emitJson(output, applied)
  const email = applied.emailOwner ? ', by email too' : ''
  const colleagues = applied.colleagueNames.length
    ? `, and ${applied.colleagueNames.join(', ')}`
    : ''
  output.write(`Applied: alerts of ${applied.label} reach you${email}${colleagues}\n`)
}

/**
 * What an Agent's owner does beside defining it, as in the app: run it now, cap the spend it may
 * approve, act on what a run skipped, and set their own Agent Access (`teler agent-access`).
 */
export async function runAgentOwnerCommand(
  group: string | undefined,
  action: string | undefined,
  args: string[],
  client: TelerApiClient,
  output: Output
): Promise<boolean> {
  if (group === 'agent-access') {
    await runAgentAccessCommand(client, output, action, args)
    return true
  }
  if (group !== 'agent') return false
  if (action === 'run') await run(client, output, args)
  else if (action === 'spend-cap') await spendCap(client, output, args)
  else if (action === 'allow-and-rerun') await allowAndRerun(client, output, args)
  else if (action === 'apply-skipped') await applySkipped(client, output, args)
  else return false
  return true
}
