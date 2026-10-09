import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { dataOrganizationIdSchema, dataProjectIdSchema } from './data-contract'

const typeIdSuffix = '[0-9a-hjkmnp-tv-z]{26}'
const typedId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_${typeIdSuffix}$`))
export const runIdSchema = typedId('expjob')
const credits = z.string().regex(/^(?:0|[1-9]\d{0,20})(?:\.\d{1,9})?$/)
export function creditNano(value: string): bigint {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'))
}
const title = z.string().max(200).optional()
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

export const runTaskSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('python'), code: source(128 * 1024) }),
  z.strictObject({
    kind: z.literal('sql'),
    sql: source(64 * 1024),
    rowLimit: z.number().int().min(1).max(1000).default(100),
  }),
  z.strictObject({ kind: z.literal('artifact'), artifact: importedArtifact }),
])

/** Logical request; funding approval is obtained from preflight, never invented locally. */
export const runSubmitInputSchema = z.strictObject({
  organizationId: dataOrganizationIdSchema.optional(),
  projectId: dataProjectIdSchema,
  chatId: typedId('chat').optional(),
  task: runTaskSchema,
  maximumCredits: credits
    .refine((value) => creditNano(value) > 0n && creditNano(value) <= 100_000_000_000n)
    .describe('Maximum approved credits, greater than zero and at most 100.'),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9._:-]{16,128}$/),
  timeoutSeconds: z.number().int().min(1).max(120).default(60),
})

export const runSelectionInputSchema = z.strictObject({
  id: runIdSchema,
  organizationId: dataOrganizationIdSchema.optional(),
})
export const runTaskJsonSchema = z.toJSONSchema(runTaskSchema, { io: 'input' })
export const runSubmitInputJsonSchema = z.toJSONSchema(runSubmitInputSchema, { io: 'input' })
export const runSelectionInputJsonSchema = z.toJSONSchema(runSelectionInputSchema, { io: 'input' })

export const runResponseSchema = z.object({
  id: runIdSchema,
  chatId: typedId('chat'),
  projectId: dataProjectIdSchema,
  status: z.enum(['queued', 'running', 'reconciling', 'completed', 'failed', 'cancelled']),
  language: z.enum(['python', 'sql', 'artifact']),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9._:-]{16,128}$/),
  maximumCredits: credits,
  chargedCredits: credits.nullable(),
  tariffVersion: z.string().min(1).max(128),
  timeoutSeconds: z.number().int().min(1).max(120),
  cancelRequested: z.boolean(),
  output: z
    .string()
    .max(64 * 1024)
    .nullable(),
  errorCode: z
    .string()
    .regex(/^[a-zA-Z0-9_]{1,128}$/)
    .nullable(),
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
  }),
])

export type RunResponse = z.infer<typeof runResponseSchema>
