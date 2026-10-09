import { z } from 'zod'

const timestampSchema = z.iso.datetime().nullable().default(null)

export const widgetRefreshStateSchema = z
  .object({
    status: z.enum(['ready', 'error']).nullable().default(null),
    lastAttemptAt: timestampSchema,
    lastSuccessAt: timestampSchema,
    errorReason: z
      .enum([
        'data_source_unavailable',
        'artifact_missing',
        'execution_failed',
        'approval_required',
      ])
      .nullable()
      .default(null),
    // A refresh paused because the owner has no credits; absent from older servers.
    pausedReason: z.enum(['no_credits']).nullable().default(null),
  })
  .default({
    status: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    errorReason: null,
    pausedReason: null,
  })
