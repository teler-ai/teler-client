import { basename } from 'node:path'
import type { SyncEvent } from './types'

/** The fields of a `sync status` registration the notifications read. */
export interface SyncRegistrationInput {
  id: string
  localPath: string
  organizationId: string
  files: Array<{
    relativePath: string
    status: string
    /** The content hash of the synced version. */
    hash?: string | null
    revision?: string | null
    documentIds?: string[]
  }>
}

interface FileState {
  status: string
  /** The synced content (hash, else the Teler revision): it changes with each edit. */
  version: string | null
  documentIds: string[]
}

interface FolderState {
  /** The folder has been fully synced at least once since the app watched it. */
  everComplete: boolean
  problems: number
  files: Map<string, FileState>
}

export type SyncState = Map<string, FolderState>

/** Files that need the user; waiting (retrying) files fix themselves. */
const PROBLEMS = new Set(['failed', 'conflict', 'unreadable', 'authentication-required'])
/** Files that sync; skipped ones (excluded, unsupported…) never become ready. */
const SYNCING = new Set(['ready', 'pending', 'processing', 'unstable', 'retrying', ...PROBLEMS])

/**
 * Compares two reads of the sync status. A folder's first full sync is one
 * event, not one per file; afterwards each new or updated file is an event.
 * The first read only sets the baseline, so nothing old is announced.
 */
export function nextSyncState(
  previous: SyncState | null,
  registrations: SyncRegistrationInput[]
): { state: SyncState; events: SyncEvent[] } {
  const state: SyncState = new Map()
  const events: SyncEvent[] = []
  for (const registration of registrations) {
    const files = new Map<string, FileState>()
    for (const file of registration.files)
      files.set(file.relativePath, {
        status: file.status,
        version: file.hash ?? file.revision ?? null,
        documentIds: file.documentIds ?? [],
      })
    const syncing = [...files.values()].filter((file) => SYNCING.has(file.status))
    const complete = syncing.length > 0 && syncing.every((file) => file.status === 'ready')
    const problems = syncing.filter((file) => PROBLEMS.has(file.status)).length
    const before = previous?.get(registration.id)
    const folder = {
      folderId: registration.id,
      folderName: basename(registration.localPath) || registration.localPath,
      organizationId: registration.organizationId,
    }
    if (previous) {
      if (before?.everComplete) {
        for (const [path, file] of files) {
          const old = before.files.get(path)
          if (file.status !== 'ready') continue
          if (old?.status === 'ready' && old.version === file.version) continue
          events.push({
            kind: 'file-ready',
            ...folder,
            path,
            documentId: file.documentIds.length === 1 ? (file.documentIds[0] ?? null) : null,
            updated: Boolean(old?.version) && old?.version !== file.version,
          })
        }
      } else if (complete) {
        events.push({ kind: 'folder-synced', ...folder, files: syncing.length })
      }
      if (problems > (before?.problems ?? 0))
        events.push({ kind: 'folder-attention', ...folder, problems })
    }
    state.set(registration.id, {
      // A folder complete when first seen was announced above, or was already
      // there at startup: either way it never announces its first sync again.
      everComplete: (before?.everComplete ?? false) || complete,
      problems,
      files,
    })
  }
  return { state, events }
}
