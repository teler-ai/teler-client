import { z } from 'zod'

const idSuffix = '[0-9a-hjkmnp-tv-z]{26}'
export const scheduleIdSchema = z.string().regex(new RegExp(`^sched_${idSuffix}$`))
const frequencySchema = z.enum(['daily', 'weekly', 'monthly'])
const timeUtcSchema = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/)
const dayOfWeekSchema = z.number().int().min(0).max(6)
const dayOfMonthSchema = z.number().int().min(1).max(31)
const definitionShape = {
  projectId: z
    .string()
    .regex(new RegExp(`^prj_${idSuffix}$`))
    .optional(),
  frequency: frequencySchema.optional(),
  timeUtc: timeUtcSchema.optional(),
  dayOfWeek: dayOfWeekSchema.nullable().optional(),
  dayOfMonth: dayOfMonthSchema.nullable().optional(),
  prompt: z.string().max(4000).nullable().optional(),
  deliveryMethod: z.enum(['chat', 'email']).optional(),
}

export const createScheduleSchema = z
  .object({
    ...definitionShape,
    agentId: z.string().regex(new RegExp(`^agent_${idSuffix}$`)),
    organizationId: z
      .string()
      .regex(new RegExp(`^org_${idSuffix}$`))
      .optional(),
    frequency: frequencySchema,
    timeUtc: timeUtcSchema,
    approvedCapabilities: z
      .array(z.string().regex(/^[a-z]+(?:\.[a-z]+)+$/))
      .max(64)
      .optional(),
  })
  .refine((value) => value.frequency !== 'weekly' || value.dayOfWeek != null)
  .refine((value) => value.frequency !== 'monthly' || value.dayOfMonth != null)

export const updateScheduleSchema = z
  .object({ ...definitionShape, isPaused: z.boolean().optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined))

export const scheduleSchema = z.object({
  id: scheduleIdSchema,
  projectId: z
    .string()
    .regex(new RegExp(`^prj_${idSuffix}$`))
    .nullable()
    .optional(),
  agentId: z.string().regex(new RegExp(`^agent_${idSuffix}$`)),
  organizationId: z.string(),
  agentName: z.string().nullable().optional(),
  agentLabel: z.string().nullable().optional(),
  frequency: frequencySchema,
  dayOfWeek: dayOfWeekSchema.nullable(),
  dayOfMonth: dayOfMonthSchema.nullable(),
  timeUtc: timeUtcSchema,
  deliveryMethod: z.enum(['chat', 'email']),
  isPaused: z.boolean(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunStatus: z.enum(['success', 'failed', 'skipped']).nullable(),
})

/**
 * A start that is not a time: a table's data updating or another Agent finishing. It has no
 * cadence or next run, so none is expected here.
 */
export const eventStartSchema = z.object({
  id: scheduleIdSchema,
  startKind: z.enum(['table_update', 'agent_finished']),
  projectId: z
    .string()
    .regex(new RegExp(`^prj_${idSuffix}$`))
    .nullable()
    .optional(),
  agentId: z.string().regex(new RegExp(`^agent_${idSuffix}$`)),
  organizationId: z.string(),
  agentName: z.string().nullable().optional(),
  agentLabel: z.string().nullable().optional(),
  startTable: z
    .object({
      kind: z.enum(['connector', 'document']),
      id: z.string(),
      label: z.string().nullable(),
    })
    .nullable(),
  startAgent: z
    .object({
      id: z.string().regex(new RegExp(`^agent_${idSuffix}$`)),
      label: z.string().nullable(),
    })
    .nullable(),
  deliveryMethod: z.enum(['chat', 'email']),
  isPaused: z.boolean(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunStatus: z.enum(['success', 'failed', 'skipped']).nullable(),
})

/** What an update or an approval returns: a time schedule, or an event start. */
export const scheduleDefinitionSchema = z.union([scheduleSchema, eventStartSchema])

export const scheduleListSchema = z.object({
  schedules: z.array(scheduleSchema),
  // Servers before event starts do not send the key.
  eventStarts: z.array(eventStartSchema).default([]),
})

export const scheduleHistorySchema = z.object({
  runs: z.array(
    z.object({
      id: z.string().regex(new RegExp(`^srun_${idSuffix}$`)),
      scheduledQueryId: scheduleIdSchema,
      status: z.enum(['success', 'failed', 'skipped']),
      agentRunId: z
        .string()
        .regex(new RegExp(`^agent_run_${idSuffix}$`))
        .nullable(),
      agentRunStatus: z
        .enum(['pending', 'claimed', 'running', 'completed', 'failed', 'cancelled'])
        .nullable(),
      chatId: z
        .string()
        .regex(new RegExp(`^chat_${idSuffix}$`))
        .nullable(),
      taskId: z
        .string()
        .regex(new RegExp(`^atask_${idSuffix}$`))
        .nullable(),
      taskStatus: z
        .string()
        .regex(/^[a-z_]{1,32}$/)
        .nullable(),
      scheduledFor: z.string(),
      executedAt: z.string(),
    })
  ),
})
