import { z } from 'zod'

export const UPLOAD_STATUSES = [
  'uploading',
  'queued',
  'processing',
  'completed',
  'partial_success',
  'failed',
] as const
export type UploadStatus = (typeof UPLOAD_STATUSES)[number]
const UPLOAD_COMPLETION_STATUSES = [
  'queued',
  'processing',
  'completed',
  'partial_success',
  'failed',
] as const

const countsSchema = z.object({
  queued: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
})

const itemSchema = z
  .object({
    id: z.string(),
    parentItemId: z.string().optional(),
    itemIndex: z.number().int().nonnegative(),
    kind: z.enum(['source', 'archive_entry', 'worksheet', 'derived']),
    logicalPath: z.string(),
    displayName: z.string(),
    format: z.string().optional(),
    sheetName: z.string().optional(),
    status: z.enum(['queued', 'processing', 'completed', 'skipped', 'failed']),
    errorCode: z.string().optional(),
    documentId: z.string().optional(),
    documentTableId: z.string().optional(),
    byteCount: z.number().int().nonnegative(),
  })
  .passthrough()

export const uploadStatusSchema = z
  .object({
    jobId: z.string(),
    status: z.enum(UPLOAD_STATUSES),
    originalFilename: z.string(),
    destinationPath: z.string(),
    errorCode: z.string().optional(),
    completedAt: z.string().optional(),
    upload: z
      .object({
        partSizeBytes: z.number().int().positive(),
        partCount: z.number().int().positive(),
        uploadedPartCount: z.number().int().nonnegative(),
        uploadedBytes: z.number().int().nonnegative(),
        totalBytes: z.number().int().nonnegative(),
        lastHeartbeatAt: z.string().optional(),
      })
      .optional(),
    processing: z
      .object({
        attempt: z.number().int().nonnegative(),
        phase: z.string(),
        percentage: z.number().optional(),
        updatedAt: z.string(),
      })
      .passthrough()
      .optional(),
    counts: countsSchema,
    items: z.array(itemSchema),
  })
  .passthrough()
export type UploadStatusResponse = z.infer<typeof uploadStatusSchema>

export const uploadListSchema = z.object({
  items: z.array(
    z
      .object({
        jobId: z.string(),
        status: z.enum(UPLOAD_STATUSES),
        originalFilename: z.string(),
        destinationPath: z.string(),
        scope: z.enum(['organization', 'personal']),
        declaredSizeBytes: z.number().int().nonnegative(),
        errorCode: z.string().optional(),
        createdAt: z.string(),
        completedAt: z.string().optional(),
      })
      .passthrough()
  ),
})

export const uploadStartSchema = z.object({
  jobId: z.string(),
  partSizeBytes: z.number().int().positive(),
  partCount: z.number().int().positive(),
  expiresAt: z.string(),
})

export const uploadCompleteSchema = z.object({
  jobId: z.string(),
  status: z.enum(UPLOAD_COMPLETION_STATUSES),
})
