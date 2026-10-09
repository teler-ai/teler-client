import { z } from 'zod'

/** A read that returns this many events may have left more for the next read. */
export const ALERT_FEED_PAGE_MAX = 50

/**
 * `GET /api/alerts/feed`: Agent alerts that opened or went back to normal.
 * Sending the last `cursor` as `after` returns what happened since. The target
 * is opened in the Teler window, so it must be a path on the Teler origin,
 * never a URL.
 */
export const alertFeedSchema = z.object({
  events: z.array(
    z.object({
      seq: z.string(),
      kind: z.enum(['opened', 'back_to_normal']),
      alertId: z.string(),
      organizationId: z.string(),
      agentLabel: z.string(),
      isOwner: z.boolean(),
      ownerName: z.string().nullable(),
      title: z.string(),
      targetPath: z
        .string()
        .max(2048)
        .refine((path) => path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')),
      openedAt: z.string(),
      occurredAt: z.string(),
    })
  ),
  cursor: z.string(),
})

export type AlertFeedEvent = z.infer<typeof alertFeedSchema>['events'][number]
