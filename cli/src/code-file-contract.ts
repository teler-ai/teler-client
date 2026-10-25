import { z } from 'zod'

const suffix = '[0-9a-hjkmnp-tv-z]{26}'
const typedId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_${suffix}$`))

export const codeFileIdSchema = typedId('doc')
export const codeRunIdSchema = typedId('scrun')
export const fileScheduleIdSchema = typedId('sched')
export const projectIdSchema = typedId('prj')
const revisionIdSchema = typedId('frev')
const credits = z.string().regex(/^(?:0|[1-9]\d{0,29})(?:\.\d{1,9})?$/)
/** A code, never free text a server relays. */
const code = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
/** A skip or failure code: SPEND_NOT_APPROVED or plan_inactive, never a sentence or a value. */
const reasonCode = z
  .string()
  .regex(/^(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)$/)
  .max(64)

/** The rule a File alerts by, as the app shows it ("Alerts when …"): one line, up to 280 characters. */
export const alertRuleSchema = z
  .string()
  .trim()
  .min(1)
  .refine((rule) => [...rule].length <= 280)
  .regex(/^\P{Cc}+$/u)

/** An input or output name the code reads with `teler.job`. */
export const jobNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)

export const savedCodeFileSchema = z.object({
  fileId: codeFileIdSchema,
  revisionId: revisionIdSchema,
  version: z.number().int().positive(),
})

/** A File's current version; an older, unversioned File has none. */
export const fileDescriptorSchema = z.object({
  revisionId: revisionIdSchema.nullable(),
  version: z.number().int().nonnegative(),
  securityVersion: z.number().int().positive().optional(),
})

/** What a run reads, as the server bound it; passed back to the server unchanged. */
export const bindingSchema = z.looseObject({
  kind: z.enum(['file', 'connector_table', 'upload_table']),
  name: jobNameSchema,
  sourceId: z.string().min(1).max(256),
})
export const bindingsResponseSchema = z.object({ bindings: z.array(bindingSchema).max(15) })

const outputSchema = z.looseObject({ slot: jobNameSchema, required: z.boolean() })

/** What a run or schedule names besides the code: parameters, inputs and outputs. */
export const declarationSchema = z.object({
  projectId: projectIdSchema.nullable(),
  parameters: z.record(z.string(), z.json()),
  bindings: z.array(bindingSchema),
  dependencies: z.array(z.looseObject({ name: jobNameSchema })),
  outputs: z.array(outputSchema).min(1),
  seed: z.number().int().nullable(),
  alertRule: z.string().max(1024).optional(),
})
export type Declaration = z.infer<typeof declarationSchema>

const availabilitySchema = z.union([
  z.object({ available: z.literal(true) }),
  z.object({ available: z.literal(false), reason: code }),
])
export const runDeclarationSchema = z.object({
  revisionId: revisionIdSchema.nullable(),
  declaration: declarationSchema.nullable(),
  schedule: availabilitySchema,
  runNow: availabilitySchema,
})

export const tariffSchema = z.object({ tariffVersion: z.string().min(1).max(100) })

export const runQuoteSchema = z.object({
  maximumCredits: credits,
  tariffVersion: z.string().min(1).max(100),
  reservedMemoryMiB: z.number().int().positive(),
  payer: z.object({ organizationId: z.string(), userId: z.string(), membershipId: z.string() }),
  funding: z.looseObject({ kind: z.enum(['personal', 'shared_manual']) }),
})

const runStatusSchema = z.enum([
  'queued',
  'running',
  'validating',
  'succeeded',
  'failed',
  'cancelled',
])
export const codeRunSchema = z.object({
  id: codeRunIdSchema,
  streamSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  occurrenceAt: z.string().optional(),
  sourceFileId: codeFileIdSchema,
  sourceRevisionId: revisionIdSchema,
  status: runStatusSchema,
  stopReason: code.nullable(),
  requiredSlots: z.array(jobNameSchema),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
})
export type CodeRun = z.infer<typeof codeRunSchema>

const spendSchema = z.object({
  status: z.enum(['active', 'expired', 'none']),
  fundingKind: code,
  maxRunMillis: z.number().int().positive(),
  maximumCreditsPerOccurrence: credits,
  maximumCreditsPerMonth: credits,
  monthToDateCredits: credits,
  expiresAt: z.string(),
})

export const fileScheduleSchema = z.object({
  id: fileScheduleIdSchema,
  targetKind: z.literal('file'),
  organizationId: z.string(),
  projectId: projectIdSchema.nullable(),
  fileId: codeFileIdSchema,
  revisionId: revisionIdSchema,
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  time: z.string(),
  timezone: z.string(),
  dayOfWeek: z.number().int().nullable(),
  dayOfMonth: z.number().int().nullable(),
  isPaused: z.boolean(),
  /** Why it paused itself for an uploaded table it reads; only `kind` is printed. */
  pauseReason: z.looseObject({ kind: reasonCode }).nullable(),
  nextRunAt: z.string(),
  definitionRevision: z.number().int().positive(),
  needsSpendApproval: z.boolean(),
  spend: spendSchema.nullable(),
  heldByAdmin: z.boolean(),
  /** The rule its runs alert by; null when it never alerts. Older servers do not send the key. */
  alertRule: z.string().max(1024).nullable().optional(),
})
export type FileSchedule = z.infer<typeof fileScheduleSchema>

/** A File schedule as `teler schedule list` needs it, so a new field never breaks the list. */
export const fileScheduleListItemSchema = z.looseObject({
  id: fileScheduleIdSchema,
  fileId: codeFileIdSchema,
  isPaused: z.boolean(),
  nextRunAt: z.string(),
})

export const spendQuoteSchema = z.object({
  tariffVersion: z.string().min(1).max(100),
  maxRunMillis: z.number().int().positive(),
  maximumCreditsPerOccurrence: credits,
  expectedOccurrencesPerMonth: z.number().nonnegative(),
  worstCaseOccurrencesPerMonth: z.number().nonnegative(),
  suggestedMaximumCreditsPerMonth: credits,
  measuredRunMillis: z.number().int().nonnegative().nullable(),
  measuredCreditsPerRun: credits.nullable(),
  monthToDateCredits: credits,
  fundingKind: code,
  computeIncluded: z.boolean(),
  expiresAt: z.string(),
  configSha256: z.string().regex(/^[0-9a-f]{64}$/),
  definitionRevision: z.number().int().positive(),
})
export type SpendQuote = z.infer<typeof spendQuoteSchema>

/** One occurrence; `reason` is the server's skip or failure code, never free text. */
export const fileScheduleRunsSchema = z.object({
  runs: z.array(
    z
      .object({
        id: typedId('srun'),
        status: z.enum(['success', 'failed', 'skipped']),
        scheduledFor: z.string(),
        executedAt: z.string(),
        errorMessage: z.string().nullable().optional(),
        savedCodeRunId: codeRunIdSchema.nullable().optional(),
        savedCodeRunStatus: runStatusSchema.nullable().optional(),
        attempts: z.number().int().nonnegative().nullable().optional(),
        settledAt: z.string().nullable().optional(),
      })
      .transform(({ errorMessage, ...run }) => ({
        ...run,
        reason: reasonCode.safeParse(errorMessage).data ?? null,
        savedCodeRunId: run.savedCodeRunId ?? null,
        savedCodeRunStatus: run.savedCodeRunStatus ?? null,
        attempts: run.attempts ?? null,
        settledAt: run.settledAt ?? null,
      }))
  ),
})
