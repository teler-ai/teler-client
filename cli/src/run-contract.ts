import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { dataOrganizationIdSchema, dataProjectIdSchema } from './data-contract'

const typeIdSuffix = '[0-9a-hjkmnp-tv-z]{26}'
const typedId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_${typeIdSuffix}$`))
export const runIdSchema = typedId('expjob')
/** The longest run any plan allows; the server refuses more than the organization's plan. */
export const MAX_EXECUTION_SECONDS = 3600
const credits = z.string().regex(/^(?:0|[1-9]\d{0,20})(?:\.\d{1,9})?$/)
export function creditNano(value: string): bigint {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'))
}
const title = z.string().max(200).optional()
/** A plain capability id, such as `tables.rows.read` or `files.create`. */
const capability = z
  .string()
  .max(64)
  .regex(/^[a-z]+(?:\.[a-z]+)+$/)
/** A capability id a server returns: safe to print, and new ids from later servers still parse. */
const returnedCapability = z
  .string()
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/)
const column = z.string().min(1).max(2048)
const rows = z.array(z.record(z.string(), z.json())).min(1).max(1000)
function source(maximum: number) {
  return z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= maximum)
}

const importedArtifact = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bar'), title, data: rows, x: column, y: column }),
  z.strictObject({ type: z.literal('line'), title, data: rows, x: column, y: column }),
  z.strictObject({ type: z.literal('table'), title, data: rows }),
  z.strictObject({
    type: z.literal('metric'),
    title,
    value: z.number().finite(),
    label: z.string().min(1).max(200),
  }),
])

const pythonTask = z.strictObject({
  kind: z.literal('python'),
  code: source(128 * 1024).describe('Python source, read from --file (at most 128 KiB).'),
})
const sqlTask = z.strictObject({
  kind: z.literal('sql'),
  sql: source(64 * 1024).describe('One SQL SELECT, read from --file (at most 64 KiB).'),
  rowLimit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe('Maximum rows to return (--row-limit).'),
})
const artifactTask = z.strictObject({
  kind: z.literal('artifact'),
  artifact: importedArtifact.describe('Static chart snapshot, read as JSON from --file.'),
})
export const runTaskSchema = z.discriminatedUnion('kind', [pythonTask, sqlTask, artifactTask])

/** Logical request; funding approval is obtained from preflight, never invented locally. */
export const runSubmitInputSchema = z.strictObject({
  organizationId: dataOrganizationIdSchema.optional(),
  projectId: dataProjectIdSchema,
  chatId: typedId('chat')
    .optional()
    .describe('One of your chats in the same project to hold the run; otherwise a new chat.'),
  task: runTaskSchema,
  maximumCredits: credits
    .refine((value) => creditNano(value) > 0n && creditNano(value) <= 100_000_000_000n)
    .describe('Maximum approved credits, greater than zero and at most 100.'),
  idempotencyKey: z
    .string()
    .regex(/^[a-zA-Z0-9._:-]{16,128}$/)
    .describe('Stable key for this task; the same key returns the same run.'),
  timeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(MAX_EXECUTION_SECONDS)
    .default(60)
    .describe(
      "Sandbox execution limit in seconds (--execution-timeout). The organization's plan sets the actual maximum."
    ),
  capabilities: z
    .array(capability)
    .min(1)
    .max(32)
    .optional()
    .describe(
      'Exactly what the run may use (--capabilities), such as tables.rows.read,files.create. Without it a run holds what your Agent Access allows without asking; with it, what Agent Access asks about waits for your approval in the Teler app.'
    ),
})

export const runSelectionInputSchema = z.strictObject({
  id: runIdSchema.describe('Run ID from a submit receipt.'),
  organizationId: dataOrganizationIdSchema.optional(),
})
export const runTaskJsonSchema = z.toJSONSchema(runTaskSchema, { io: 'input' })
export const runSubmitInputJsonSchema = z.toJSONSchema(runSubmitInputSchema, { io: 'input' })
/** One submit command's input: the shared fields with only that command's task. */
export const runSubmitInputJsonSchemas = {
  python: z.toJSONSchema(runSubmitInputSchema.extend({ task: pythonTask }), { io: 'input' }),
  sql: z.toJSONSchema(runSubmitInputSchema.extend({ task: sqlTask }), { io: 'input' }),
  artifact: z.toJSONSchema(runSubmitInputSchema.extend({ task: artifactTask }), { io: 'input' }),
}
export const runSelectionInputJsonSchema = z.toJSONSchema(runSelectionInputSchema, { io: 'input' })

export const runResponseSchema = z.object({
  id: runIdSchema,
  chatId: typedId('chat'),
  projectId: dataProjectIdSchema,
  status: z.enum([
    'needs_approval',
    'queued',
    'running',
    'reconciling',
    'completed',
    'failed',
    'cancelled',
  ]),
  /** What the run holds once it may start, from servers that return it. */
  capabilities: z.array(returnedCapability).max(64).nullable().optional(),
  /** What a `needs_approval` run waits for the person to approve, and where. */
  approval: z
    .object({
      requestId: typedId('clireq'),
      path: z.string().regex(new RegExp(`^/cli-requests/clireq_${typeIdSuffix}$`)),
      expiresAt: z.string().datetime(),
      asks: z.array(z.object({ capability: returnedCapability })).max(64),
      scopes: z.array(z.string().max(32)).max(8),
    })
    .nullable()
    .optional(),
  language: z.enum(['python', 'sql', 'artifact']),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9._:-]{16,128}$/),
  maximumCredits: credits,
  chargedCredits: credits.nullable(),
  tariffVersion: z.string().min(1).max(128),
  timeoutSeconds: z.number().int().min(1).max(86_400),
  cancelRequested: z.boolean(),
  output: z
    .string()
    .max(64 * 1024)
    .nullable(),
  errorCode: z
    .string()
    .regex(/^[a-zA-Z0-9_]{1,128}$/)
    .nullable(),
  /** A failed run's own traceback or error message, from servers that return it. */
  errorDetail: z
    .string()
    .max(64 * 1024)
    .nullable()
    .optional(),
  /** Which limit of the sandbox stopped the run, from servers that return it; passed through as sent. */
  limit: z
    .looseObject({ kind: z.string().max(128) })
    .nullable()
    .optional(),
  executionTimeMs: z.number().finite().min(0).nullable(),
  artifacts: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        slug: z.string().min(1).max(512),
        category: z.string().min(1).max(64),
        type: z.string().min(1).max(64),
        title: z.string().nullable(),
      })
    )
    .max(100),
  artifactsTruncated: z.boolean(),
  createdAt: z.string().datetime(),
  settledAt: z.string().datetime().nullable(),
})

export const runPreflightResponseSchema = z.union([
  z.object({ run: runResponseSchema }),
  z.object({
    run: z.null(),
    maximumCredits: credits,
    funding: z.object({
      kind: z.enum(['personal', 'shared_manual']),
      availableOrganizationCredits: credits,
      split: z.object({
        organizationCredits: credits,
        personalCredits: credits,
        referralCredits: credits,
      }),
    }),
    payer: z.object({
      organizationId: dataOrganizationIdSchema,
      userId: typedId('user'),
      membershipId: typedId('member'),
    }),
    tariffVersion: z.string().min(1).max(128),
    reservedMemoryMiB: z.number().int().positive(),
    /** What a run without --capabilities leaves out, from servers that return it. */
    capabilities: z
      .object({
        excluded: z
          .array(z.object({ capability: returnedCapability, state: z.enum(['ask', 'deny']) }))
          .max(64),
      })
      .optional(),
  }),
])

export type RunResponse = z.infer<typeof runResponseSchema>
