import type { BunFile } from 'bun'
export interface SyncIdentity {
  localPath: string
  origin: string
  accountId: string
  organizationId: string
  destination: string
  /** The project the files belong to; the organization's default project when absent. */
  projectId?: string
}
export interface SyncRegistration extends SyncIdentity {
  id: string
  paused: boolean
  status: string
  checkedAt: number | null
}
export interface SyncFile {
  registrationId: string
  relativePath: string
  hash: string | null
  revision: string | null
  pendingHash: string | null
  requestId: string | null
  jobId: string | null
  snapshotPath: string | null
  status: string
  attempts: number
  retryAt: number
  /** Why the last attempt failed: a server error code, `HTTP_<status>` or `NETWORK`. */
  error?: string | null
  /** The Teler documents of the last committed version (`doc_…`). */
  documentIds?: string[]
}
export interface SyncSnapshot {
  relativePath: string
  hash: string
  localPath: string
  size: number
}
export interface SyncSkipped {
  relativePath: string
  reason: string
}
export interface SyncResult {
  status: 'ready' | 'pending' | 'failed' | 'conflict'
  jobId?: string
  revision?: string
  /** The Teler documents the committed file became. */
  documentIds?: string[]
}
export interface SyncRemote {
  accountId(): Promise<string>
  transfer(
    registration: SyncRegistration,
    file: SyncFile,
    bytes: BunFile,
    saveJob: (jobId: string) => void
  ): Promise<SyncResult>
}
