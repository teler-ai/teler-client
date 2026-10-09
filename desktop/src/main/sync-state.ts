import { basename, isAbsolute, relative, sep } from 'node:path'
import type {
  DesktopResult,
  FileCounts,
  FolderInput,
  FolderPreview,
  FolderStatus,
  ProblemFile,
  SyncHealth,
  SyncedFolder,
} from '../shared/desktop-api'
import { isValidDestination } from '../shared/destination'
import type { SyncPreview, SyncStatus } from './sync-cli'

type StatusRegistration = SyncStatus['registrations'][number]
type StatusFile = StatusRegistration['files'][number]

const SYNCED = new Set(['ready'])
const PENDING = new Set(['pending', 'processing', 'unstable'])
/** Retrying after a temporary failure: automatic, so not a problem to act on. */
const WAITING = 'retrying'
const PROBLEMS = new Set(['failed', 'conflict', 'unreadable', 'authentication-required'])
const MAX_PROBLEM_FILES = 20

function toProblemFile(file: StatusFile): ProblemFile {
  return {
    relativePath: file.relativePath,
    status: file.status,
    retryAt: file.status === WAITING ? (file.retryAt ?? null) : null,
    reason: file.error ?? null,
  }
}

const FOLDER_STATUS: Record<string, FolderStatus> = {
  ready: 'ready',
  pending: 'pending',
  'authentication-required': 'sign-in-required',
  'connection-unavailable': 'offline',
  'root-unavailable': 'unavailable',
  'attention-required': 'attention',
}

function folderStatus(
  registration: StatusRegistration,
  accountId: string | null,
  problems: number
): FolderStatus {
  // The CLI pins each registration to the account that created it; another
  // account's token can never sync it, so reconnecting cannot recover it.
  if (accountId !== null && registration.accountId !== accountId) return 'other-account'
  if (registration.paused) return 'paused'
  // The CLI also flags retrying files for attention; the app shows them as waiting.
  if (registration.status === 'attention-required' && problems === 0) return 'pending'
  return FOLDER_STATUS[registration.status] ?? 'pending'
}

/**
 * `accountId` is the connected sync account, or null when disconnected;
 * `projectName` is known when the folder was added from a project.
 */
export function toSyncedFolder(
  registration: StatusRegistration,
  accountId: string | null = null,
  projectName: string | null = null
): SyncedFolder {
  const counts: FileCounts = { synced: 0, pending: 0, waiting: 0, problems: 0, skipped: 0 }
  for (const file of registration.files) {
    if (SYNCED.has(file.status)) counts.synced++
    else if (PENDING.has(file.status)) counts.pending++
    else if (file.status === WAITING) counts.waiting++
    else if (PROBLEMS.has(file.status)) counts.problems++
    else counts.skipped++
  }
  const problemFiles = registration.files
    .filter((file) => PROBLEMS.has(file.status))
    .map(toProblemFile)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .slice(0, MAX_PROBLEM_FILES)
  const waitingFiles = registration.files
    .filter((file) => file.status === WAITING)
    .map(toProblemFile)
    .sort((a, b) => (a.retryAt ?? 0) - (b.retryAt ?? 0))
    .slice(0, MAX_PROBLEM_FILES)
  return {
    id: registration.id,
    localPath: registration.localPath,
    name: basename(registration.localPath) || registration.localPath,
    destination: registration.destination,
    status: folderStatus(registration, accountId, counts.problems),
    counts,
    problemFiles,
    waitingFiles,
    nextRetryAt: waitingFiles[0]?.retryAt ?? null,
    organizationId: registration.organizationId,
    projectId: registration.projectId ?? null,
    projectName: registration.projectId ? projectName : null,
    checkedAt: registration.checkedAt,
  }
}

export interface HealthInput {
  connected: boolean
  syncPaused: boolean
  /** The supervisor is waiting to restart a daemon that exited unexpectedly. */
  daemonRestarting: boolean
  folders: readonly SyncedFolder[]
}

/** One overall state, most urgent first, for the tray and the settings banner. */
export function summarizeHealth(input: HealthInput): SyncHealth {
  if (!input.connected) return 'not-connected'
  if (input.folders.length === 0) return 'no-folders'
  if (input.syncPaused) return 'paused'
  const statuses = new Set(input.folders.map((folder) => folder.status))
  if (statuses.has('sign-in-required')) return 'sign-in-required'
  if (input.daemonRestarting) return 'stopped'
  if (statuses.has('offline')) return 'offline'
  if (statuses.has('attention') || statuses.has('unavailable') || statuses.has('other-account'))
    return 'attention'
  if (statuses.has('pending')) return 'syncing'
  if (input.folders.every((folder) => folder.status === 'paused')) return 'paused'
  return 'up-to-date'
}

/** Files still to upload, including those waiting to retry. */
export function pendingFileCount(folders: readonly SyncedFolder[]): number {
  return folders.reduce((total, folder) => total + folder.counts.pending + folder.counts.waiting, 0)
}

const MAX_SAMPLE_FILES = 20

export function toFolderPreview(preview: SyncPreview): FolderPreview {
  const skipped = { excluded: 0, unsupported: 0, other: 0 }
  for (const file of preview.skipped) {
    if (file.reason === 'excluded') skipped.excluded++
    else if (file.reason === 'unsupported') skipped.unsupported++
    else skipped.other++
  }
  return {
    localPath: preview.localPath,
    destination: preview.destination,
    fileCount: preview.files.length,
    totalBytes: preview.files.reduce((total, file) => total + file.bytes, 0),
    sampleFiles: preview.files.slice(0, MAX_SAMPLE_FILES).map((file) => file.relativePath),
    skipped,
  }
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

/**
 * Nested or repeated folders would upload the same files twice, so a new
 * folder may neither contain nor sit inside an existing one. Paths are real
 * paths, as the CLI stores them.
 */
export function overlapsSyncedFolder(candidate: string, existing: readonly string[]): boolean {
  return existing.some((folder) => contains(folder, candidate) || contains(candidate, folder))
}

/** Checks a folder before preview or registration and returns its real path. */
export async function resolveFolderInput(
  input: FolderInput,
  folders: readonly SyncedFolder[],
  realpath: (path: string) => Promise<string>
): Promise<DesktopResult<string>> {
  if (!isValidDestination(input.destination)) return { ok: false, error: 'invalid-destination' }
  let localPath: string
  try {
    localPath = await realpath(input.localPath)
  } catch {
    return { ok: false, error: 'invalid-folder' }
  }
  if (
    overlapsSyncedFolder(
      localPath,
      folders.map((folder) => folder.localPath)
    )
  )
    return { ok: false, error: 'already-synced' }
  return { ok: true, value: localPath }
}
