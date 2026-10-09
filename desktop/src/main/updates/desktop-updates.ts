import type { ReleaseFetch } from '@teler-ai/cli/releases'
import type { Translate } from '../i18n'
import { findUpdate, type AvailableUpdate, type Installation } from './find-update'

/** The first check waits for the window to load and sign in. */
const STARTUP_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 12 * 60 * 60_000

export interface UpdateMessage {
  kind: 'info' | 'error'
  title: string
  detail: string
  buttons: string[]
}

export interface DesktopUpdatesDeps {
  currentVersion: string
  installation: Installation
  /** Check on startup and periodically (packaged builds, unless turned off). */
  automatic: boolean
  fetch?: ReleaseFetch
  translate(): Translate
  /** The available update changed: menus and the tray show it. */
  onChange(): void
  notify(title: string, body: string, onClick: () => void): void
  /** Shows a message and resolves with the index of the chosen button. */
  ask(message: UpdateMessage): Promise<number>
  openExternal(url: string): void
}

/**
 * Teler Desktop updates: a check shortly after startup and twice a day, a
 * notification per new version, and "Check for Updates…" on demand. Updating
 * downloads the installer for this platform from the official releases.
 */
export class DesktopUpdates {
  available: AvailableUpdate | null = null
  private notified: string | null = null
  private checking: Promise<AvailableUpdate | null> | null = null
  /** Manual checks in progress: they answer with a dialog, not a notification. */
  private manualChecks = 0
  private asking = false
  private timers: NodeJS.Timeout[] = []

  constructor(private readonly deps: DesktopUpdatesDeps) {}

  start(): void {
    if (!this.deps.automatic) return
    const check = () => void this.check(true).catch(() => undefined)
    this.timers = [setTimeout(check, STARTUP_DELAY_MS), setInterval(check, CHECK_INTERVAL_MS)]
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  /** "Check for Updates…": says what it found, and offers the download. */
  async checkNow(): Promise<void> {
    if (this.asking) return
    const t = this.deps.translate()
    let update: AvailableUpdate | null
    this.manualChecks += 1
    try {
      update = await this.check(false)
    } catch {
      await this.ask({
        kind: 'error',
        title: t('update.failed.title'),
        detail: t('update.failed.detail'),
        buttons: [t('update.ok')],
      })
      return
    } finally {
      this.manualChecks -= 1
    }
    if (update) await this.offer(update)
    else
      await this.ask({
        kind: 'info',
        title: t('update.current.title'),
        detail: t('update.current.detail', { version: this.deps.currentVersion }),
        buttons: [t('update.ok')],
      })
  }

  /** The tray's "Update to Teler …": confirm, then download. */
  async install(): Promise<void> {
    if (this.available) await this.offer(this.available)
  }

  private async offer(update: AvailableUpdate): Promise<void> {
    const t = this.deps.translate()
    const choice = await this.ask({
      kind: 'info',
      title: t('update.available.title', { version: update.version }),
      detail: t('update.available.detail', { current: this.deps.currentVersion }),
      buttons: [t('update.available.download'), t('update.available.later')],
    })
    if (choice === 0) this.deps.openExternal(update.downloadUrl)
  }

  /** One update dialog at a time; another request while it is open is dropped. */
  private async ask(message: UpdateMessage): Promise<number | null> {
    if (this.asking) return null
    this.asking = true
    try {
      return await this.deps.ask(message)
    } finally {
      this.asking = false
    }
  }

  /** One check at a time; automatic checks announce each new version once. */
  private check(announce: boolean): Promise<AvailableUpdate | null> {
    this.checking ??= findUpdate(
      this.deps.currentVersion,
      this.deps.installation,
      this.deps.fetch
    ).finally(() => (this.checking = null))
    return this.checking.then((update) => {
      if (update?.version !== this.available?.version) {
        this.available = update
        this.deps.onChange()
      }
      if (update && this.notified !== update.version) {
        this.notified = update.version
        if (!announce || this.manualChecks > 0) return update
        const t = this.deps.translate()
        this.deps.notify(
          t('update.notification.title', { version: update.version }),
          t('update.notification.body'),
          () => void this.offer(update)
        )
      }
      return update
    })
  }
}
