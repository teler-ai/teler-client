import { createHash, randomUUID } from 'node:crypto'
import { constants, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { mkdir, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { ApiError } from './errors'
import { isRetryableUploadError } from './upload-retry'
import { scanFolder } from './sync-scan'
import type { SyncStore } from './sync-store'
import type { SyncFile, SyncRemote } from './sync-types'

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/
/** Without Retry-After, wait a minute before starting uploads again. */
const DEFAULT_THROTTLE_MS = 60_000

/** A code safe to store and show: a plain server constant, the status, or NETWORK. */
function errorCode(error: unknown): string {
  if (error instanceof ApiError)
    return error.code && SAFE_CODE.test(error.code) ? error.code : `HTTP_${error.status}`
  return error instanceof TypeError ? 'NETWORK' : 'UNKNOWN'
}

export function emptySyncFile(registrationId: string, relativePath: string): SyncFile {
  return {
    registrationId,
    relativePath,
    hash: null,
    revision: null,
    pendingHash: null,
    requestId: null,
    jobId: null,
    snapshotPath: null,
    status: 'pending',
    attempts: 0,
    retryAt: 0,
    error: null,
  }
}
export async function reconcile(
  store: SyncStore,
  id: string,
  remote: SyncRemote,
  snapshots: string,
  stableMs = 1_000,
  protectedPaths?: string[],
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const registration = store.get(id)
  if (!registration || registration.paused) return
  try {
    if ((await remote.accountId()) !== registration.accountId) {
      store.update(id, { status: 'authentication-required', checkedAt: Date.now() })
      return
    }
  } catch (error) {
    store.update(id, {
      status:
        error instanceof ApiError && [401, 403].includes(error.status)
          ? 'authentication-required'
          : 'connection-unavailable',
      checkedAt: Date.now(),
    })
    return
  }
  let scan: Awaited<ReturnType<typeof scanFolder>>
  try {
    scan = await scanFolder(registration.localPath, stableMs, protectedPaths, signal)
  } catch {
    store.update(id, { status: 'root-unavailable', checkedAt: Date.now() })
    return
  }
  const existing = new Map(store.files(id).map((file) => [file.relativePath, file]))
  for (const skipped of scan.skipped) {
    const file = existing.get(skipped.relativePath) ?? emptySyncFile(id, skipped.relativePath)
    store.saveFile({ ...file, status: skipped.reason })
  }
  const seen = new Set([
    ...scan.files.map((file) => file.relativePath),
    ...scan.skipped.map((file) => file.relativePath),
  ])
  for (const file of existing.values()) {
    if (!seen.has(file.relativePath))
      store.saveFile({ ...file, status: 'local-missing-remote-retained' })
  }
  for (const snapshot of scan.files) {
    signal?.throwIfAborted()
    const current = store.get(id)
    if (!current || current.paused) break
    let file = existing.get(snapshot.relativePath) ?? emptySyncFile(id, snapshot.relativePath)
    if (file.hash === snapshot.hash && !file.pendingHash) {
      store.saveFile({ ...file, status: 'ready' })
      continue
    }
    if (
      file.retryAt > Date.now() &&
      !(file.pendingHash !== snapshot.hash && ['failed', 'conflict'].includes(file.status))
    )
      continue
    if (['failed', 'conflict'].includes(file.status) && file.pendingHash === snapshot.hash) continue
    // Rate limited: start nothing new until the server's Retry-After has passed;
    // uploads that already started may finish.
    const started = file.jobId !== null && !['failed', 'conflict'].includes(file.status)
    if (!started && store.throttledUntil() > Date.now()) continue
    let unsavedSnapshot: string | null = null
    // Complete already-started work from its immutable snapshot, even if local bytes changed.
    try {
      if (
        !file.pendingHash ||
        ((!file.jobId || ['failed', 'conflict'].includes(file.status)) &&
          file.pendingHash !== snapshot.hash)
      ) {
        if (file.snapshotPath) await unlink(file.snapshotPath).catch(() => undefined)
        await mkdir(snapshots, { recursive: true, mode: 0o700 })
        const snapshotPath = join(snapshots, randomUUID())
        unsavedSnapshot = snapshotPath
        const source = await open(snapshot.localPath, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          await pipeline(
            source.createReadStream({ autoClose: false }),
            createWriteStream(snapshotPath, { flags: 'wx', mode: 0o600 }),
            { signal }
          )
        } finally {
          await source.close()
        }
        const hash = createHash('sha256')
        for await (const chunk of Bun.file(snapshotPath).stream()) hash.update(chunk)
        if (hash.digest('hex') !== snapshot.hash) {
          await unlink(snapshotPath)
          store.saveFile({ ...file, status: 'unstable' })
          continue
        }
        file = {
          ...file,
          pendingHash: snapshot.hash,
          requestId: randomUUID(),
          jobId: null,
          snapshotPath,
          status: 'pending',
          attempts: 0,
          retryAt: 0,
        }
        store.saveFile(file)
        unsavedSnapshot = null
      }
      if (!file.snapshotPath) throw new Error('Snapshot unavailable')
      const bytes = Bun.file(file.snapshotPath)
      const result = await remote.transfer(registration, file, bytes, (jobId) => {
        file = { ...file, jobId, status: 'processing' }
        store.saveFile(file)
      })
      if (result.status === 'ready' && result.revision) {
        const completedSnapshot = file.snapshotPath
        file = {
          ...file,
          hash: file.pendingHash,
          revision: result.revision,
          ...(result.documentIds ? { documentIds: result.documentIds } : {}),
          pendingHash: null,
          requestId: null,
          jobId: null,
          snapshotPath: null,
          status: file.pendingHash === snapshot.hash ? 'ready' : 'pending',
          attempts: 0,
          retryAt: 0,
          error: null,
        }
        store.saveFile(file)
        await unlink(completedSnapshot).catch(() => undefined)
      } else
        file = {
          ...file,
          status: result.status,
          jobId: result.jobId ?? file.jobId,
          error: result.status === 'failed' ? file.error : null,
        }
      store.saveFile(file)
    } catch (error) {
      if (unsavedSnapshot) await unlink(unsavedSnapshot).catch(() => undefined)
      signal?.throwIfAborted()
      if (error instanceof ApiError && error.code === 'SYNC_STAGE_EXPIRED') {
        store.saveFile({
          ...file,
          requestId: randomUUID(),
          jobId: null,
          status: 'pending',
          attempts: 0,
          retryAt: Date.now() + 1_000,
        })
        continue
      }
      if (error instanceof ApiError && error.status === 429) {
        // The server counts refused requests against the limit too, so stop
        // every start, not just this file's, and don't grow its backoff.
        const until = Date.now() + (error.retryAfterMs ?? DEFAULT_THROTTLE_MS)
        store.throttle(until)
        store.saveFile({ ...file, status: 'retrying', retryAt: until, error: errorCode(error) })
        continue
      }
      const authentication = error instanceof ApiError && [401, 403].includes(error.status)
      const retryable =
        isRetryableUploadError(error) ||
        (error instanceof ApiError &&
          ['INGEST_IN_PROGRESS', 'SYNC_NOT_READY'].includes(error.code ?? ''))
      const conflict = error instanceof ApiError && error.status === 409 && !retryable
      const permanent =
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 429].includes(error.status) &&
        !retryable
      file = {
        ...file,
        status: authentication
          ? 'authentication-required'
          : conflict
            ? 'conflict'
            : permanent
              ? 'failed'
              : 'retrying',
        attempts: file.attempts + 1,
        retryAt: Date.now() + Math.min(300_000, 1_000 * 2 ** Math.min(file.attempts, 8)),
        error: errorCode(error),
      }
      store.saveFile(file)
      if (authentication) break
    }
  }
  const states = store.files(id).map((file) => file.status)
  const status = states.includes('authentication-required')
    ? 'authentication-required'
    : states.some((state) => ['failed', 'conflict', 'retrying', 'unreadable'].includes(state))
      ? 'attention-required'
      : states.some((state) => ['pending', 'processing', 'unstable'].includes(state))
        ? 'pending'
        : 'ready'
  store.update(id, { status, checkedAt: Date.now() })
}
