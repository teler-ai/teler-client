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

/** The chart kinds a widget that follows a File schedule can draw. */
export const FOLLOW_CHARTS = ['line', 'bar', 'scatter', 'pie', 'table', 'number'] as const

const columnSchema = z.string().trim().min(1).max(255)

/**
 * A widget that follows a scheduled File's output slot: each successful run of the schedule, or
 * its owner's Run now, redraws the chart. Only the schedule's owner can connect it, to a
 * dashboard in the schedule's project.
 */
export const followDashboardWidgetSchema = z
  .object({
    scheduleId: z.string().regex(new RegExp(`^sched_${idSuffix}$`)),
    slot: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    chart: z.enum(FOLLOW_CHARTS),
    x: columnSchema.optional(),
    y: columnSchema.optional(),
    color: columnSchema.optional(),
    title: z.string().trim().min(1).max(255).optional(),
  })
  .refine(
    ({ chart, x, y }) =>
      chart === 'table' || chart === 'number' || (x !== undefined && y !== undefined),
    'A line, bar, scatter or pie chart needs --x and --y'
  )
  .refine(({ chart, color }) => color === undefined || ['line', 'bar', 'scatter'].includes(chart))

/** The renderer binding the server reads a followed output with. */
export function followBinding(input: z.infer<typeof followDashboardWidgetSchema>) {
  const base = { schemaVersion: 1 as const, slot: input.slot }
  if (input.chart === 'table') return { ...base, renderer: 'table' as const, config: {} }
  if (input.chart === 'number')
    return {
      ...base,
      renderer: 'metric' as const,
      config: input.y === undefined ? {} : { valueField: input.y },
    }
  const encoding =
    input.chart === 'pie'
      ? { names: input.x, values: input.y }
      : { x: input.x, y: input.y, ...(input.color ? { color: input.color } : {}) }
  return { ...base, renderer: 'chart' as const, config: { type: input.chart, encoding } }
}

export const followMutationResponseSchema = z.object({
  widgetId: z.string().regex(new RegExp(`^dwgt_${idSuffix}$`)),
  dashboardId: dashboardIdSchema,
})

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
