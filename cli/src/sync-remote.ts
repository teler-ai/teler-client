import type { BunFile } from 'bun'
import { basename, posix } from 'node:path'
import { z } from 'zod'
import { TelerApiClient, type FetchLike } from './api'
import { authStatus } from './auth'
import {
  createConfiguredCredentialStore,
  resolveCredential,
  type CredentialStore,
} from './credentials'
import { ApiError } from './errors'
import { contentTypeFor } from './file-mime'
import type { SyncFile, SyncRegistration, SyncRemote, SyncResult } from './sync-types'

import { uploadCompleteSchema } from './upload-contract'
import { resolveTelerUrl } from './url'

const preparedSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  partSizeBytes: z.number().int().positive().optional(),
  partCount: z.number().int().positive().optional(),
})
const statusSchema = z.object({ status: z.string() })
const committedSchema = z.object({ revision: z.string(), documentIds: z.array(z.string()) })
export interface SyncRemoteDeps {
  env: NodeJS.ProcessEnv
  store?: CredentialStore
  fetch?: FetchLike
  signal?: AbortSignal
}
export function createSyncRemote(origin: string, deps: SyncRemoteDeps): SyncRemote {
  const request: FetchLike = (input, init) => {
    const signal = AbortSignal.any([
      AbortSignal.timeout(60_000),
      ...(deps.signal ? [deps.signal] : []),
      ...(init?.signal ? [init.signal] : []),
    ])
    signal.throwIfAborted()
    return (deps.fetch ?? fetch)(input, { ...init, signal })
  }
  let client: TelerApiClient | undefined
  return {
    async accountId() {
      const url = resolveTelerUrl({ TELER_URL: origin })
      // An environment credential is only sent to the origin selected when the process started.
      const env =
        resolveTelerUrl(deps.env).origin === origin
          ? deps.env
          : { ...deps.env, TELER_TOKEN: undefined }
      const credential = await resolveCredential(
        deps.store ?? (() => createConfiguredCredentialStore(env)),
        origin,
        env
      )
      if (!credential) throw new ApiError('Sync authentication required', 401)
      const identity = await authStatus(url, credential.token, request)
      client = new TelerApiClient(url, credential.token, request)
      return identity.user.id
    },
    async transfer(registration, file, bytes, saveJob) {
      if (!client) throw new ApiError('Sync authentication required', 401)
      return transfer(client, registration, file, bytes, saveJob)
    },
  }
}
async function transfer(
  client: TelerApiClient,
  registration: SyncRegistration,
  file: SyncFile,
  bytes: BunFile,
  saveJob: (id: string) => void
): Promise<SyncResult> {
  const metadata = {
    clientRequestId: file.requestId,
    sourceId: registration.id,
    relativePath: file.relativePath,
    contentHash: file.pendingHash,
    expectedRevision: file.revision,
    organizationId: registration.organizationId,
    ...(registration.projectId ? { projectId: registration.projectId } : {}),
    destinationPath: posix.join(registration.destination, posix.dirname(file.relativePath)),
    filename: basename(file.relativePath),
    sizeBytes: bytes.size,
    scope: registration.destination.startsWith('/organization') ? 'organization' : 'personal',
    contentType: contentTypeFor(file.relativePath),
  }
  let observed: z.infer<typeof statusSchema> | undefined
  if (file.jobId) {
    try {
      observed = await client.json(`/api/uploads/${encodeURIComponent(file.jobId)}`, statusSchema)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // Let the engine create a fresh request while retaining its snapshot and revision.
        throw new ApiError('Sync job expired', 409, 'SYNC_STAGE_EXPIRED')
      }
      throw error
    }
  }
  const prepared: z.infer<typeof preparedSchema> =
    file.jobId && observed && observed.status !== 'uploading'
      ? { jobId: file.jobId, status: observed.status }
      : await client.json('/api/uploads/sync', preparedSchema, {
          method: 'POST',
          body: JSON.stringify(metadata),
        })
  if (!observed || observed.status === 'uploading') {
    saveJob(prepared.jobId)
    observed = undefined
  }
  const endpoint = `/api/uploads/${encodeURIComponent(prepared.jobId)}`
  if (prepared.status === 'uploading') {
    if (!prepared.partCount || !prepared.partSizeBytes)
      throw new ApiError('Sync upload plan is invalid', 502)
    const heartbeat = setInterval(() => {
      void client
        .request(`${endpoint}/heartbeat`, { method: 'POST', body: '{}' })
        .catch(() => undefined)
    }, 20_000)
    try {
      for (let part = 1; part <= prepared.partCount; part++) {
        const offset = (part - 1) * prepared.partSizeBytes
        // Send the part's actual bytes: a lazy file slice reports its requested
        // range as its size, and compiled Bun executables cannot stream file
        // bodies. Parts are bounded by the server's plan (8 MiB).
        const body = new Uint8Array(
          await bytes.slice(offset, offset + prepared.partSizeBytes).arrayBuffer()
        )
        await client.request(`${endpoint}/parts/${part}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(body.byteLength),
          },
          body,
        })
      }
      await client.json(`${endpoint}/complete`, uploadCompleteSchema, {
        method: 'POST',
        body: '{}',
      })
    } finally {
      clearInterval(heartbeat)
    }
  }
  const status = observed ?? (await client.json(endpoint, statusSchema))
  if (
    status.status === 'failed' ||
    status.status === 'partial_success' ||
    status.status === 'awaiting_input'
  )
    return { status: 'failed', jobId: prepared.jobId }
  if (status.status !== 'completed') return { status: 'pending', jobId: prepared.jobId }
  const committed = await client.json(
    `/api/uploads/sync/${encodeURIComponent(prepared.jobId)}/commit`,
    committedSchema,
    { method: 'POST', body: JSON.stringify(metadata) }
  )
  return {
    status: 'ready',
    jobId: prepared.jobId,
    revision: committed.revision,
    documentIds: committed.documentIds,
  }
}
