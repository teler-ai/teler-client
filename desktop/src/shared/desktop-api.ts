/**
 * Contract between the Electron main process and the local Synced folders page.
 *
 * Only the bundled Synced folders page receives this bridge. The remote Teler web
 * app never gets a preload script, Node access, or any of these channels.
 */
import type { ColorMode, ThemeVariant } from './appearance'
import type { SupportedLanguage } from './languages'

export const DESKTOP_CHANNELS = {
  getState: 'desktop:get-state',
  stateChanged: 'desktop:state-changed',
  connect: 'desktop:connect',
  disconnect: 'desktop:disconnect',
  chooseFolder: 'desktop:choose-folder',
  previewFolder: 'desktop:preview-folder',
  addFolder: 'desktop:add-folder',
  pauseFolder: 'desktop:pause-folder',
  resumeFolder: 'desktop:resume-folder',
  removeFolder: 'desktop:remove-folder',
  revealFolder: 'desktop:reveal-folder',
  setSyncPaused: 'desktop:set-sync-paused',
  setOpenAtLogin: 'desktop:set-open-at-login',
  openTeler: 'desktop:open-teler',
  retryFolder: 'desktop:retry-folder',
  setNotificationSetting: 'desktop:set-notification-setting',
  dismissFolderRequest: 'desktop:dismiss-folder-request',
} as const

/** Overall sync state shown in the tray and the Synced folders page. */
export type SyncHealth =
  | 'not-connected'
  | 'no-folders'
  | 'up-to-date'
  | 'syncing'
  | 'paused'
  | 'attention'
  | 'sign-in-required'
  | 'offline'
  | 'stopped'

export type FolderStatus =
  | 'pending'
  | 'ready'
  | 'paused'
  | 'attention'
  | 'sign-in-required'
  | 'offline'
  | 'unavailable'
  /** Registered by another Teler account; re-add it to sync with this one. */
  | 'other-account'

export interface FileCounts {
  synced: number
  pending: number
  /** Retrying automatically after a temporary failure; not a problem to act on. */
  waiting: number
  problems: number
  skipped: number
}

export interface ProblemFile {
  relativePath: string
  /** Raw CLI file status such as `failed`, `conflict`, `retrying` or `unreadable`. */
  status: string
  /** When a `retrying` file is tried again (epoch ms). */
  retryAt: number | null
  /**
   * Why the last attempt failed: a Teler error code such as `RATE_LIMITED` or
   * `UPLOAD_NOT_CONFIGURED`, `HTTP_<status>`, or `NETWORK`.
   */
  reason: string | null
}

/**
 * Desktop notifications, by source, and whether they play the OS sound. None
 * show while a Teler window is in the foreground.
 */
export interface NotificationSettings {
  /** Files that are ready in Teler, new or updated (grouped). */
  files: boolean
  /** A folder that finished its first sync. */
  folders: boolean
  /** Files that need attention (one per folder and problem). */
  problems: boolean
  /** A chat whose turn finished. */
  chats: boolean
  /** An Agent alert that opened, or went back to normal. */
  alerts: boolean
  sound: boolean
}

export type NotificationSetting = keyof NotificationSettings

export interface OrganizationSummary {
  id: string
  name: string
}

export interface SyncedFolder {
  id: string
  localPath: string
  name: string
  /** Remote path inside `/personal` or `/organization`. */
  destination: string
  status: FolderStatus
  counts: FileCounts
  /** At most 20 files that need attention, sorted by path. */
  problemFiles: ProblemFile[]
  /** At most 20 files waiting to retry, soonest first. */
  waitingFiles: ProblemFile[]
  /** The soonest automatic retry among waiting files (epoch ms). */
  nextRetryAt: number | null
  organizationId: string
  projectId: string | null
  /** Known when the folder was added from a project; for display. */
  projectName: string | null
  checkedAt: number | null
}

export interface SyncAccount {
  id: string
  name: string | null
}

export type DesktopErrorCode =
  /** Connecting needs a Teler session in the main window. */
  | 'signed-out'
  | 'connect-denied'
  | 'connect-expired'
  | 'connect-failed'
  | 'no-organization'
  /** The API refused a newly approved token: the account has no CLI access. */
  | 'not-eligible'
  | 'not-connected'
  | 'network'
  | 'invalid-folder'
  | 'invalid-destination'
  | 'already-synced'
  /** A sync command ran past its time limit, for example previewing a huge folder. */
  | 'timeout'
  | 'sync-failed'

/**
 * Connecting approves sync with the account signed in to the Teler window, so
 * there is no code to show. Sync follows that session: signing out disconnects
 * it and signing back in reconnects it.
 */
export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected'
  account: SyncAccount | null
  error: DesktopErrorCode | null
}

/** Where a folder's files belong in Teler, besides their destination path. */
export interface SyncTarget {
  /** Absent: the account's active organization. */
  organizationId?: string
  /** Absent: the organization's default project. */
  projectId?: string
  /** For display only; sent by the web app with `projectId`. */
  projectName?: string
}

/** "Sync a folder" from the Teler web app, waiting for the Synced folders page. */
export interface FolderRequest {
  /** Increases per request, so a repeated request is seen as new. */
  id: number
  target: SyncTarget
}

export interface DesktopPreferences {
  language: SupportedLanguage
  themeVariant: ThemeVariant
  colorMode: ColorMode
}

export interface DesktopState {
  origin: string
  platform: 'darwin' | 'win32' | 'linux'
  connection: ConnectionState
  health: SyncHealth
  syncPaused: boolean
  openAtLogin: boolean
  /**
   * False in development builds: a login item there would launch the stock
   * Electron binary, not Teler.
   */
  openAtLoginAvailable: boolean
  /** `session` when no OS keyring is available: reconnect after each restart. */
  credentialPersistence: 'encrypted' | 'session'
  folders: SyncedFolder[]
  preferences: DesktopPreferences
  folderRequest: FolderRequest | null
  /**
   * Teler limits how fast an account starts uploads; until this time (epoch
   * ms) no upload starts. Null when not limited.
   */
  throttledUntil: number | null
  /** The account's organizations, to show and choose where folders sync. */
  organizations: OrganizationSummary[]
  /** The organization open in the Teler window, when known. */
  activeOrganizationId: string | null
  notifications: NotificationSettings
}

export interface FolderPreview {
  localPath: string
  destination: string
  fileCount: number
  totalBytes: number
  /** First 20 files that would upload, as relative paths. */
  sampleFiles: string[]
  skipped: { excluded: number; unsupported: number; other: number }
}

export interface FolderInput {
  localPath: string
  destination: string
  organizationId?: string
  projectId?: string
  /** For display in the folder list; sent with `projectId`. */
  projectName?: string
}

export type DesktopResult<T> = { ok: true; value: T } | { ok: false; error: DesktopErrorCode }

export interface DesktopApi {
  getState(): Promise<DesktopState>
  /** Returns an unsubscribe function. */
  onStateChanged(listener: (state: DesktopState) => void): () => void
  /**
   * Connects sync to the account signed in to the Teler window and resolves
   * when connected; `signed-out` when no one is signed in.
   */
  connect(): Promise<DesktopResult<null>>
  /** Disconnects until the user connects again, even across sign-ins. */
  disconnect(): Promise<void>
  /** Opens the native folder picker; `null` when cancelled. */
  chooseFolder(): Promise<string | null>
  previewFolder(input: FolderInput): Promise<DesktopResult<FolderPreview>>
  addFolder(input: FolderInput): Promise<DesktopResult<SyncedFolder>>
  pauseFolder(id: string): Promise<DesktopResult<null>>
  resumeFolder(id: string): Promise<DesktopResult<null>>
  /** Stops syncing the folder. Files already in Teler are kept. */
  removeFolder(id: string): Promise<DesktopResult<null>>
  revealFolder(id: string): Promise<void>
  setSyncPaused(paused: boolean): Promise<void>
  setOpenAtLogin(enabled: boolean): Promise<void>
  /** Focuses the Teler window, optionally at a same-origin path such as `/files`. */
  openTeler(path?: string): Promise<void>
  setNotificationSetting(setting: NotificationSetting, enabled: boolean): Promise<void>
  /** Tries the folder's waiting files now instead of at their retry time. */
  retryFolder(id: string): Promise<DesktopResult<null>>
  /** Marks a folder request as handled (the folder picker was shown). */
  dismissFolderRequest(id: number): Promise<void>
}
