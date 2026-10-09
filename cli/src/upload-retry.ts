import { ApiError } from './errors'

export const MAX_UPLOAD_ATTEMPTS = 3
const DEFAULT_RETRY_DELAY_MS = 250
const MAX_COMMAND_RETRY_DELAY_MS = 5_000
const RETRYABLE_CONFLICT_CODES = new Set([
  'UPLOAD_SETUP_IN_PROGRESS',
  'PART_BUSY',
  'PART_LEASE_LOST',
])

export function isRetryableUploadError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof ApiError &&
      (error.status === 429 ||
        error.status >= 500 ||
        (error.status === 409 &&
          error.code !== undefined &&
          RETRYABLE_CONFLICT_CODES.has(error.code))))
  )
}

export function uploadRetryDelay(error: unknown): number {
  // A retry inside one command waits a few seconds at most.
  return error instanceof ApiError && error.retryAfterMs !== undefined
    ? Math.min(error.retryAfterMs, MAX_COMMAND_RETRY_DELAY_MS)
    : DEFAULT_RETRY_DELAY_MS
}

export function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Teler operation aborted'))
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Teler operation aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function retryUploadOperation<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isRetryableUploadError(error) || attempt === MAX_UPLOAD_ATTEMPTS) throw error
      await abortableDelay(uploadRetryDelay(error), signal)
    }
  }
  throw lastError
}
