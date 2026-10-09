import { z } from 'zod'

const idSuffix = '[0-9a-hjkmnp-tv-z]{26}'
export const dashboardIdSchema = z.string().regex(new RegExp(`^dash_${idSuffix}$`))
export const refreshIntervalSchema = z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d'])

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
    refreshInterval: refreshIntervalSchema,
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
