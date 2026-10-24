import { z } from 'zod'

const idSuffix = '[0-9a-hjkmnp-tv-z]{26}'
export const dashboardIdSchema = z.string().regex(new RegExp(`^dash_${idSuffix}$`))
/**
 * The refresh settings a dashboard can be given: never on its own, when its data changes, or an
 * interval. The server refuses an interval below the plan's minimum, with a hint naming the choices.
 */
export const REFRESH_CHOICES = [
  'manual',
  'on_change',
  '15m',
  '30m',
  '1h',
  '4h',
  '5h',
  '1d',
] as const
export const refreshIntervalSchema = z.enum(REFRESH_CHOICES)

export const createDashboardSchema = z.object({
  organizationId: z
    .string()
    .regex(new RegExp(`^org_${idSuffix}$`))
    .optional(),
  projectId: z
    .string()
    .regex(new RegExp(`^prj_${idSuffix}$`))
    .optional(),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5_000).optional(),
  visibility: z.enum(['private', 'organization']).default('private'),
  refreshInterval: refreshIntervalSchema.optional(),
})

const updateDashboardRefreshSchema = z.object({ refreshInterval: refreshIntervalSchema })

export const createDashboardInputJsonSchema = z.toJSONSchema(createDashboardSchema, {
  io: 'input',
})
export const updateDashboardRefreshInputJsonSchema = z.toJSONSchema(updateDashboardRefreshSchema, {
  io: 'input',
})

export const addDashboardWidgetSchema = z.object({
  artifactId: z.string().regex(new RegExp(`^artifact_${idSuffix}$`)),
  position: z
    .object({
      x: z.number().int().min(0).max(3),
      y: z.number().int().min(0).max(999),
      w: z.number().int().min(1).max(4),
      h: z.number().int().min(1).max(20),
    })
    .strict()
    .refine((position) => position.x + position.w <= 4),
  idempotencyKey: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.:-]+$/)
    .optional(),
})

export const dashboardMutationResponseSchema = z
  .object({
    id: dashboardIdSchema,
    name: z.string(),
    description: z.string().nullable(),
    // As stored, which may be an older interval than the ones offered now.
    refreshInterval: z.string().min(1).max(32),
    lastRefreshedAt: z.string().nullable(),
  })
  .transform(({ id, ...dashboard }) => ({ dashboardId: id, ...dashboard }))

export const widgetMutationResponseSchema = z
  .object({
    id: z.string().regex(new RegExp(`^dwgt_${idSuffix}$`)),
    dashboardId: dashboardIdSchema,
    artifactId: z.string().regex(new RegExp(`^artifact_${idSuffix}$`)),
    position: z.record(z.string(), z.unknown()),
    sortOrder: z.number().int(),
  })
  .transform(({ id, ...widget }) => ({ widgetId: id, ...widget }))

const capabilityIdSchema = z.string().regex(/^[a-z]+(?:\.[a-z]+)+$/)

/** what the owner approved the dashboard's scheduled refresh to use. */
export const dashboardRefreshApprovalSchema = z.object({
  dashboardId: dashboardIdSchema,
  approvedCapabilities: z.array(capabilityIdSchema).max(64),
  notApproved: z.array(capabilityIdSchema).max(64).default([]),
  approvedAt: z.string(),
})
