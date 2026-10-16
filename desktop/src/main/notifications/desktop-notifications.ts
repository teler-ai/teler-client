import { Notification, type Session } from 'electron'
import type { DesktopActivity, NotificationSettings } from '../../shared/desktop-api'
import type { SupportedLanguage } from '../../shared/languages'
import type { FetchLike } from '../device-login'
import type { Translate } from '../i18n'
import { ALERT_FEED_PAGE_MAX, alertFeedSchema } from './alert-events'
import {
  activityOf,
  AttentionTracker,
  attentionSchema,
  toNotificationEvents,
} from './attention-events'
import { NotificationBatcher } from './batcher'
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
  inbox: 3_000,
}
const MAX_WAIT_MS = 60_000
/** macOS system sounds, one per kind; elsewhere the OS plays its default sound. */
const MAC_SOUNDS: Record<NotificationKind, string> = {
  files: 'Pop',
  folders: 'Glass',
  problems: 'Basso',
  chats: 'Hero',
  alerts: 'Ping',
  inbox: 'Purr',
}
/** Attention is read often while something runs or right after a message, else every 20 s. */
const ACTIVE_POLL_MS = 5_000
/** Startup: give the window time to load and sign in (and pass Cloudflare Access). */
const FIRST_POLL_MS = 10_000
const IDLE_POLL_MS = 20_000
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
  /** The target is what a focused Teler window shows: no need to notify about it. */
  onScreen(target: NotificationTarget): boolean
  showTeler(path: string): void
  openSettings(): void
  /** What runs and waits, after every attention read; null while signed out. */
  onActivity(activity: DesktopActivity | null): void
  /** Local diagnostics; the OS text never carries credentials. */
  warn?(message: string): void
}

/**
 * Desktop notifications for synced files and folders, problems, finished chats, Agent alerts
 * and Teler's own notifications: grouped per kind, never for what the person has open in a
 * focused window, and with the OS notification sound (so Do Not Disturb applies) unless sound
 * is off. The same attention read feeds the tray's counts.
 */
export class DesktopNotifications {
  private sync: SyncState | null = null
  /** Consecutive attention reads; replaced after a sign-out so the next read is a baseline. */
  private tracker = new AttentionTracker()
  private active = false
  private readonly shown = new Map<NotificationKind, Notification>()
  private readonly batcher = new NotificationBatcher(QUIET_MS, MAX_WAIT_MS, (kind, items) =>
    this.deliver(kind, items)
  )
  /** The alert feed's cursor; null until the baseline read, which announces nothing. */
  private alertCursor: string | null = null
  private attentionTimer: NodeJS.Timeout | null = null
  private alertTimer: NodeJS.Timeout | null = null
  private fastUntil = 0
  private stopped = false
  private unsupportedWarned = false

  constructor(private readonly deps: DesktopNotificationsDeps) {}

  /** Starts watching; a message sent from the window speeds the watch up. */
  start(session: Session): void {
    session.webRequest.onCompleted({ urls: ['*://*/api/chat/*'] }, (details) => {
      const url = new URL(details.url)
      if (
        details.method === 'POST' &&
        url.origin === this.deps.origin &&
        MESSAGE_PATH.test(url.pathname)
      ) {
        this.fastUntil = Date.now() + AFTER_MESSAGE_MS
        this.scheduleAttention(ACTIVE_POLL_MS)
      }
    })
    this.scheduleAttention(FIRST_POLL_MS)
    this.scheduleAlerts(FIRST_POLL_MS)
  }

  stop(): void {
    this.stopped = true
    if (this.attentionTimer) clearTimeout(this.attentionTimer)
    if (this.alertTimer) clearTimeout(this.alertTimer)
    this.batcher.clear()
  }

  /** Reads attention now, for example once the window has signed in. */
  refresh(): void {
    this.scheduleAttention(0)
  }

  /** Sync needs the user to reconnect: always worth a notification, unless Synced folders is open. */
  signInRequired(): void {
    if (this.stopped || this.deps.onScreen({ type: 'synced-folders' })) return
    if (!this.supported()) return
    const t = this.deps.translate()
    const notification = new Notification({
      title: t('notification.signInRequired.title'),
      body: t('notification.signInRequired.body'),
      silent: !this.deps.settings().sound,
    })
    notification.on('click', () => this.deps.openSettings())
    this.show(notification)
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

  /** Opens a notification's target in the Teler window, switching organization first. */
  async openTarget(target: NotificationTarget): Promise<void> {
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

  private enqueue(kind: NotificationKind, event: NotificationEvent): void {
    if (this.deps.settings()[kind]) this.batcher.add(kind, event)
  }

  private supported(): boolean {
    if (Notification.isSupported()) return true
    if (!this.unsupportedWarned) {
      this.unsupportedWarned = true
      this.deps.warn?.('Desktop notifications are not supported on this system.')
    }
    return false
  }

  private show(notification: Notification): void {
    notification.on('failed', (_event, error) =>
      this.deps.warn?.(`A desktop notification could not be shown: ${error}`)
    )
    notification.show()
  }

  private deliver(kind: NotificationKind, items: NotificationEvent[]): void {
    const settings = this.deps.settings()
    if (this.stopped || !settings[kind] || !this.supported()) return
    const composed = composeNotification(kind, items, this.deps.translate(), this.deps.language())
    // The person is looking at it already.
    if (this.deps.onScreen(composed.target)) return
    // A newer notification of the same kind replaces the previous one.
    this.shown.get(kind)?.close()
    const notification = new Notification({
      title: composed.title,
      body: composed.body,
      silent: !settings.sound,
      ...(settings.sound && this.deps.platform === 'darwin' ? { sound: MAC_SOUNDS[kind] } : {}),
    })
    notification.on('click', () => void this.openTarget(composed.target))
    this.show(notification)
    this.shown.set(kind, notification)
  }

  private scheduleAttention(delay: number): void {
    if (this.stopped) return
    if (this.attentionTimer) clearTimeout(this.attentionTimer)
    this.attentionTimer = setTimeout(() => void this.pollAttention(), delay)
  }

  /**
   * One read of what runs and waits. The first read after start or a sign-out is a baseline;
   * afterwards `since` is the previous cursor, so a turn that starts and ends between two
   * reads is still announced, and nothing is announced twice.
   */
  private async pollAttention(): Promise<void> {
    try {
      const since = this.tracker.cursor
      const response = await this.deps.windowFetch(
        `${this.deps.origin}/api/attention${since ? `?since=${encodeURIComponent(since)}` : ''}`,
        { redirect: 'manual', headers: { Accept: 'application/json' } }
      )
      const parsed = response.ok ? attentionSchema.safeParse(await response.json()) : null
      if (parsed?.success) {
        const { chats, inbox } = toNotificationEvents(this.tracker.next(parsed.data))
        for (const chat of chats) this.enqueue('chats', chat)
        for (const notice of inbox) this.enqueue('inbox', notice)
        const activity = activityOf(parsed.data)
        this.active = activity.runningChats + activity.runningAgents > 0
        this.deps.onActivity(activity)
      } else if (
        response.status === 401 ||
        response.status === 403 ||
        (response.status >= 300 && response.status < 400)
      ) {
        // Signed out: whoever signs in next starts from a new baseline.
        this.tracker = new AttentionTracker()
        this.active = false
        this.deps.onActivity(null)
      }
    } catch {
      // Offline: try again at the next poll.
    }
    const busy = this.active || Date.now() < this.fastUntil
    this.scheduleAttention(busy ? ACTIVE_POLL_MS : IDLE_POLL_MS)
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
