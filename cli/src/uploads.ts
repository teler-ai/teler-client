import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { TelerApiClient } from './api'
import type { Output } from './chats'
import { emitJson, resolveOrganizationId } from './command-output'
import { contentTypeFor } from './file-mime'
import {
  uploadCompleteSchema,
  uploadListSchema,
  uploadStartSchema,
  uploadStatusSchema,
  type UploadStatus,
  type UploadStatusResponse,
} from './upload-contract'
import {
  abortableDelay,
  isRetryableUploadError,
  MAX_UPLOAD_ATTEMPTS,
  retryUploadOperation,
  uploadRetryDelay,
} from './upload-retry'
export type { UploadStatus } from './upload-contract'
const TERMINAL = new Set<UploadStatus>(['completed', 'partial_success', 'failed'])
const HEARTBEAT_INTERVAL_MS = 20_000

interface OrganizationOption {
  organizationId?: string
  signal?: AbortSignal
}

export interface ListUploadsOptions extends OrganizationOption {
  status?: UploadStatus
  limit?: number
}

export async function listUploads(
  client: TelerApiClient,
  output: Output,
  options: ListUploadsOptions
): Promise<void> {
  const organizationId = await resolveOrganizationId(client, options.organizationId, options.signal)
  const query = new URLSearchParams({ organizationId, limit: String(options.limit ?? 20) })
  if (options.status) query.set('status', options.status)
  const result = await client.json(`/api/uploads?${query}`, uploadListSchema, {
    signal: options.signal,
  })
  if (output.json) return emitJson(output, result)
  if (result.items.length === 0) return output.write('No uploads found.\n')
  for (const item of result.items) {
    output.write(
      `${item.jobId}\t${item.status}\t${item.originalFilename}\t${item.destinationPath}\n`
    )
  }
}

export async function getUploadStatus(
  client: TelerApiClient,
  jobId: string,
  signal?: AbortSignal
): Promise<UploadStatusResponse> {
  return await client.json(`/api/uploads/${encodeURIComponent(jobId)}`, uploadStatusSchema, {
    signal,
  })
}

export async function showUploadStatus(
  client: TelerApiClient,
  output: Output,
  jobId: string,
  options: { wait: boolean; signal?: AbortSignal; pollIntervalMs?: number }
): Promise<void> {
  const result = options.wait
    ? await waitForUpload(client, jobId, options.signal, options.pollIntervalMs)
    : await getUploadStatus(client, jobId, options.signal)
  emitStatus(output, result)
}

export interface UploadLocalFileOptions extends OrganizationOption {
  filePath: string
  destinationPath?: string
  scope: 'organization' | 'personal'
  projectId?: string
  wait: boolean
  pollIntervalMs?: number
}

export async function uploadLocalFile(
  client: TelerApiClient,
  output: Output,
  options: UploadLocalFileOptions
): Promise<void> {
  const organizationId = await resolveOrganizationId(client, options.organizationId, options.signal)
  const file = Bun.file(options.filePath)
  if (!(await file.exists())) throw new Error('Local upload file was not found')
  if (file.size < 1) throw new Error('Local upload file is empty')
  const filename = basename(options.filePath)
  const destinationPath = normalizeUploadDestination(options.destinationPath, options.scope)
  const requestBody = {
    clientRequestId: `cli_${randomUUID()}`,
    organizationId,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    filename,
    sizeBytes: file.size,
    destinationPath,
    scope: options.scope,
    contentType: contentTypeFor(filename),
  }
  const start = await retryUploadOperation(
    () =>
      client.json('/api/uploads', uploadStartSchema, {
        method: 'POST',
        body: JSON.stringify(requestBody),
        signal: options.signal,
      }),
    options.signal
  )
  const clearHeartbeat = heartbeat(client, start.jobId, options.signal)
  let heartbeatStopped = false
  const stopHeartbeat = () => {
    if (heartbeatStopped) return
    heartbeatStopped = true
    clearHeartbeat()
  }
  let completed = false
  try {
    for (let partNumber = 1; partNumber <= start.partCount; partNumber += 1) {
      const offset = (partNumber - 1) * start.partSizeBytes
      const part = file.slice(offset, Math.min(file.size, offset + start.partSizeBytes))
      const reconciled = await uploadPart(client, start.jobId, partNumber, part, options.signal)
      if (reconciled) {
        completed = true
        stopHeartbeat()
        if (options.wait && !TERMINAL.has(reconciled.status)) {
          emitStatus(
            output,
            await waitForUpload(client, start.jobId, options.signal, options.pollIntervalMs)
          )
        } else if (options.wait) emitStatus(output, reconciled)
        else emitAccepted(output, reconciled.jobId, reconciled.status)
        return
      }
    }
    const accepted = await completeUpload(client, start.jobId, options.signal)
    completed = true
    stopHeartbeat()
    if (options.wait && !TERMINAL.has(accepted.status)) {
      emitStatus(
        output,
        await waitForUpload(client, start.jobId, options.signal, options.pollIntervalMs)
      )
    } else if (options.wait) {
      emitStatus(output, await getUploadStatus(client, start.jobId, options.signal))
    } else {
      emitAccepted(output, accepted.jobId, accepted.status)
    }
  } finally {
    stopHeartbeat()
    if (!completed) {
      await client
        .request(`/api/uploads/${encodeURIComponent(start.jobId)}`, {
          method: 'DELETE',
          signal: options.signal,
        })
        .catch(() => undefined)
    }
  }
}

function normalizeUploadDestination(
  destinationPath: string | undefined,
  scope: UploadLocalFileOptions['scope']
): string {
  const trimmed = destinationPath?.trim()
  if (!trimmed) return `/${scope}`
  if (trimmed.startsWith('/')) return trimmed
  return `/${scope}/${trimmed}`
}

async function uploadPart(
  client: TelerApiClient,
  jobId: string,
  partNumber: number,
  body: Blob,
  signal?: AbortSignal
): Promise<UploadStatusResponse | null> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      await client.request(`/api/uploads/${encodeURIComponent(jobId)}/parts/${partNumber}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(body.size),
        },
        body,
        signal,
      })
      return null
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw error
      const status = await getUploadStatus(client, jobId, signal).catch(() => null)
      if (status?.status !== 'uploading') {
        if (status) return status
      } else if ((status.upload?.uploadedPartCount ?? 0) >= partNumber) return null
      if (!isRetryableUploadError(error) || attempt === MAX_UPLOAD_ATTEMPTS) break
      await abortableDelay(uploadRetryDelay(error), signal)
    }
  }
  throw lastError
}

async function completeUpload(client: TelerApiClient, jobId: string, signal?: AbortSignal) {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await client.json(
        `/api/uploads/${encodeURIComponent(jobId)}/complete`,
        uploadCompleteSchema,
        {
          method: 'POST',
          body: '{}',
          signal,
        }
      )
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw error
      const status = await getUploadStatus(client, jobId, signal).catch(() => null)
      if (status && status.status !== 'uploading') return { jobId, status: status.status }
      if (!isRetryableUploadError(error) || attempt === MAX_UPLOAD_ATTEMPTS) break
      await abortableDelay(uploadRetryDelay(error), signal)
    }
  }
  throw lastError
}

async function waitForUpload(
  client: TelerApiClient,
  jobId: string,
  signal?: AbortSignal,
  pollIntervalMs = 1_000
) {
  for (;;) {
    const status = await getUploadStatus(client, jobId, signal)
    if (TERMINAL.has(status.status)) return status
    await abortableDelay(pollIntervalMs, signal)
  }
}

function heartbeat(client: TelerApiClient, jobId: string, signal?: AbortSignal): () => void {
  const timer = setInterval(() => {
    void client
      .request(`/api/uploads/${encodeURIComponent(jobId)}/heartbeat`, {
        method: 'POST',
        body: '{}',
        signal,
      })
      .catch(() => undefined)
  }, HEARTBEAT_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

function emitStatus(output: Output, status: UploadStatusResponse): void {
  if (output.json) emitJson(output, status)
  else
    output.write(
      `${status.jobId}\t${status.status}\t${status.originalFilename}\t${status.destinationPath}\n`
    )
}

function emitAccepted(output: Output, jobId: string, status: UploadStatus): void {
  if (output.json) emitJson(output, { jobId, status })
  else output.write(`Upload ${jobId} accepted (${status}).\n`)
}
