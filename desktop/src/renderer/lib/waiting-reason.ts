import type { ProblemFile } from '../../shared/desktop-api'

/** Keys in `folders.waitingReason`: short copy for why a file is waiting or failed. */
export type WaitingReasonKey =
  | 'rateLimited'
  | 'network'
  | 'notConfigured'
  | 'storageFull'
  | 'processing'
  | 'serverError'
  | 'failed'

const BY_CODE: Record<string, WaitingReasonKey> = {
  RATE_LIMITED: 'rateLimited',
  HTTP_429: 'rateLimited',
  NETWORK: 'network',
  UPLOAD_NOT_CONFIGURED: 'notConfigured',
  // Teler's answer when the destination's storage is full.
  STORAGE_QUOTA_EXCEEDED: 'storageFull',
  INGEST_IN_PROGRESS: 'processing',
  SYNC_NOT_READY: 'processing',
}

/** Maps a Teler error code to friendly copy; the raw code is never shown. */
export function waitingReasonKey(reason: string | null): WaitingReasonKey {
  if (!reason) return 'failed'
  const known = BY_CODE[reason]
  if (known) return known
  return /^HTTP_5\d\d$/.test(reason) ? 'serverError' : 'failed'
}

/** The most common reason among the listed files; a tie goes to the sooner retry. */
export function commonWaitingReason(files: ProblemFile[]): WaitingReasonKey | null {
  const tally = new Map<WaitingReasonKey, number>()
  for (const file of files) {
    const key = waitingReasonKey(file.reason)
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  let best: WaitingReasonKey | null = null
  for (const [key, count] of tally) if (best === null || count > (tally.get(best) ?? 0)) best = key
  return best
}
