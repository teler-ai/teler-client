import type { AlertFeedEvent } from './alert-events'
import type { NotificationSetting } from '../../shared/desktop-api'

/** A source of notifications; each has its own switch, sound and grouping. */
export type NotificationKind = Exclude<NotificationSetting, 'sound'>

export interface FileReadyEvent {
  kind: 'file-ready'
  folderId: string
  folderName: string
  organizationId: string
  path: string
  /** Set when the file became exactly one Teler document, to open it. */
  documentId: string | null
  /** True when an already-synced file changed; false for a new one. */
  updated: boolean
}

export interface FolderSyncedEvent {
  kind: 'folder-synced'
  folderId: string
  folderName: string
  organizationId: string
  files: number
}

export interface FolderAttentionEvent {
  kind: 'folder-attention'
  folderId: string
  folderName: string
  organizationId: string
  problems: number
}

export interface ChatFinishedEvent {
  kind: 'chat-finished'
  id: string
  title: string | null
  organizationId: string | null
}

export type SyncEvent = FileReadyEvent | FolderSyncedEvent | FolderAttentionEvent
/** An Agent alert that opened or went back to normal, as the alert feed reports it. */
export type AlertEvent = AlertFeedEvent

export type NotificationEvent = SyncEvent | ChatFinishedEvent | AlertEvent

/** Where clicking a notification goes. */
export type NotificationTarget =
  { type: 'teler'; path: string; organizationId: string | null } | { type: 'synced-folders' }

export interface ComposedNotification {
  kind: NotificationKind
  title: string
  body: string
  target: NotificationTarget
}
