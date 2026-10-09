import { Notification, type Session } from 'electron'
import type { NotificationSettings } from '../../shared/desktop-api'
import type { SupportedLanguage } from '../../shared/languages'
import type { FetchLike } from '../device-login'
import type { Translate } from '../i18n'
import { ALERT_FEED_PAGE_MAX, alertFeedSchema } from './alert-events'
import { NotificationBatcher } from './batcher'
import { chatListSchema, nextChatState, type ChatInfo } from './chat-events'
import { composeNotification } from './compose'
import { nextSyncState, type SyncRegistrationInput, type SyncState } from './sync-events'
import type { NotificationEvent, NotificationKind, NotificationTarget } from './types'

/** How long a kind must be quiet before its grouped notification goes out. */
const QUIET_MS: Record<NotificationKind, number> = {
  files: 10_000,
  folders: 3_000,
  problems: 10_000,
  chats: 3_000,
  alerts: 3_000,
}
const MAX_WAIT_MS = 60_000
/** macOS system sounds, one per kind; elsewhere the OS plays its default sound. */
const MAC_SOUNDS: Record<NotificationKind, string> = {
  files: 'Pop',
  folders: 'Glass',
  problems: 'Basso',
  chats: 'Hero',
  alerts: 'Ping',
}
/** Chats are checked often while one runs or right after a message, else rarely. */
const ACTIVE_POLL_MS = 5_000
/** Startup: give the window time to load and sign in (and pass Cloudflare Access). */
const FIRST_POLL_MS = 10_000
const IDLE_POLL_MS = 60_000
/** The alert feed is read once a minute; a full page is followed up at once. */
const ALERT_POLL_MS = 60_000
const ALERT_CATCH_UP_MS = 2_000
const AFTER_MESSAGE_MS = 10 * 60_000
const MESSAGE_PATH = /^\/api\/chat\/[^/]+\/message$/

export interface DesktopNotificationsDeps {
  origin: string
  authOrigin: string
  platform: NodeJS.Platform
  /** Requests with the Teler window's session cookies. */
  windowFetch: FetchLike
  settings(): NotificationSettings
  translate(): Translate
  /** The language of the app, for dates in notification copy. */
  language(): SupportedLanguage
  /** A Teler window is in the foreground: nothing shows or plays then. */
  isForeground(): boolean
  showTeler(path: string): void
  openSettings(): void
}

/**
 * Desktop notifications for synced files and folders, problems, finished
 * chats and Agent alerts: grouped per kind, never while Teler is in front, and with the OS
 * notification sound (so Do Not Disturb applies) unless sound is off.
 */
export class DesktopNotifications {
  private sync: SyncState | null = null
  private running: Map<string, ChatInfo> | null = null
  private readonly shown = new Map<NotificationKind, Notification>()
  private readonly batcher = new NotificationBatcher(QUIET_MS, MAX_WAIT_MS, (kind, items) =>
    this.deliver(kind, items)
  )
  /** The alert feed's cursor; null until the baseline read, which announces nothing. */
  private alertCursor: string | null = null
  private chatTimer: NodeJS.Timeout | null = null
  private alertTimer: NodeJS.Timeout | null = null
  private fastUntil = 0
  private stopped = false

  constructor(private readonly deps: DesktopNotificationsDeps) {}

  /** Starts watching chats; a message sent from the window speeds the watch up. */
  start(session: Session): void {
    session.webRequest.onCompleted({ urls: ['*://*/api/chat/*'] }, (details) => {
      const url = new URL(details.url)
      if (
        details.method === 'POST' &&
        url.origin === this.deps.origin &&
        MESSAGE_PATH.test(url.pathname)
      ) {
        this.fastUntil = Date.now() + AFTER_MESSAGE_MS
        this.scheduleChats(ACTIVE_POLL_MS)
      }
    })
    this.scheduleChats(FIRST_POLL_MS)
    this.scheduleAlerts(FIRST_POLL_MS)
  }

  stop(): void {
    this.stopped = true
    if (this.chatTimer) clearTimeout(this.chatTimer)
    if (this.alertTimer) clearTimeout(this.alertTimer)
    this.batcher.clear()
  }

  /** Sync needs the user to reconnect: always worth a notification, unless Teler is in front. */
  signInRequired(): void {
    if (this.stopped || this.deps.isForeground() || !Notification.isSupported()) return
    const t = this.deps.translate()
    const notification = new Notification({
      title: t('notification.signInRequired.title'),
      body: t('notification.signInRequired.body'),
      silent: !this.deps.settings().sound,
    })
    notification.on('click', () => this.deps.openSettings())
    notification.show()
  }

  /** A new `sync status` read. */
  syncChanged(registrations: SyncRegistrationInput[]): void {
    const { state, events } = nextSyncState(this.sync, registrations)
    this.sync = state
    for (const event of events)
      this.enqueue(
        event.kind === 'file-ready'
          ? 'files'
          : event.kind === 'folder-synced'
            ? 'folders'
            : 'problems',
        event
      )
  }

  private enqueue(kind: NotificationKind, event: NotificationEvent): void {
    if (this.deps.settings()[kind]) this.batcher.add(kind, event)
  }

  private deliver(kind: NotificationKind, items: NotificationEvent[]): void {
    const settings = this.deps.settings()
    if (this.stopped || !settings[kind] || this.deps.isForeground()) return
    if (!Notification.isSupported()) return
    const composed = composeNotification(kind, items, this.deps.translate(), this.deps.language())
    // A newer notification of the same kind replaces the previous one.
    this.shown.get(kind)?.close()
    const notification = new Notification({
      title: composed.title,
      body: composed.body,
      silent: !settings.sound,
      ...(settings.sound && this.deps.platform === 'darwin' ? { sound: MAC_SOUNDS[kind] } : {}),
    })
    notification.on('click', () => void this.open(composed.target))
    notification.show()
    this.shown.set(kind, notification)
  }

  private async open(target: NotificationTarget): Promise<void> {
    if (target.type === 'synced-folders') return this.deps.openSettings()
    // Teler shows one organization at a time: switch to the source's first.
    // Always: the page may have switched since the app last read the session.
    const { organizationId } = target
    if (organizationId)
      await this.deps
        .windowFetch(`${this.deps.authOrigin}/api/user/active-organization`, {
          method: 'PUT',
          redirect: 'manual',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        })
        .catch(() => undefined)
    this.deps.showTeler(target.path)
  }

  private scheduleChats(delay: number): void {
    if (this.stopped) return
    if (this.chatTimer) clearTimeout(this.chatTimer)
    this.chatTimer = setTimeout(() => void this.pollChats(), delay)
  }

  private async pollChats(): Promise<void> {
    if (this.deps.settings().chats) {
      try {
        const response = await this.deps.windowFetch(`${this.deps.origin}/api/chat?limit=50`, {
          redirect: 'manual',
          headers: { Accept: 'application/json' },
        })
        const parsed = response.ok ? chatListSchema.safeParse(await response.json()) : null
        if (parsed?.success) {
          const { running, finished } = nextChatState(this.running, parsed.data.chats)
          this.running = running
          for (const chat of finished) this.enqueue('chats', { kind: 'chat-finished', ...chat })
        }
      } catch {
        // Offline or signed out: try again at the next poll.
      }
    } else this.running = null
    const busy = (this.running?.size ?? 0) > 0 || Date.now() < this.fastUntil
    this.scheduleChats(busy ? ACTIVE_POLL_MS : IDLE_POLL_MS)
  }

  private scheduleAlerts(delay: number): void {
    if (this.stopped) return
    if (this.alertTimer) clearTimeout(this.alertTimer)
    this.alertTimer = setTimeout(() => void this.pollAlerts(), delay)
  }

  /**
   * The first read after start (or after the switch was off, or a sign-out) is
   * a baseline: only alerts after its cursor are announced.
   */
  private async pollAlerts(): Promise<void> {
    let next = ALERT_POLL_MS
    if (this.deps.settings().alerts) {
      try {
        const after = this.alertCursor ? `?after=${encodeURIComponent(this.alertCursor)}` : ''
        const response = await this.deps.windowFetch(
          `${this.deps.origin}/api/alerts/feed${after}`,
          {
            redirect: 'manual',
            headers: { Accept: 'application/json' },
          }
        )
        const parsed = response.ok ? alertFeedSchema.safeParse(await response.json()) : null
        if (parsed?.success) {
          const { events, cursor } = parsed.data
          if (this.alertCursor !== null) for (const event of events) this.enqueue('alerts', event)
          this.alertCursor = cursor
          if (events.length >= ALERT_FEED_PAGE_MAX) next = ALERT_CATCH_UP_MS
        } else if (
          response.status === 401 ||
          response.status === 403 ||
          (response.status >= 300 && response.status < 400)
        ) {
          // Signed out: whoever signs in next starts from a new baseline.
          this.alertCursor = null
        }
      } catch {
        // Offline: try again at the next poll.
      }
    } else this.alertCursor = null
    this.scheduleAlerts(next)
  }
}
