import { app, BaseWindow, Menu, nativeTheme, session, shell } from 'electron'
import type {
  DesktopPreferences,
  DesktopState,
  FolderRequest,
  SyncTarget,
} from '../shared/desktop-api'
import type { SupportedLanguage } from '../shared/languages'
import { PREFERENCE_COOKIE_NAMES } from '../shared/preference-cookies'
import { buildApplicationMenu } from './app-menu'
import { aboutPanelOptions, themeSurface } from './branding'
import type { FetchLike } from './device-login'
import { createTranslator, type Translate } from './i18n'
import { registerIpc } from './ipc'
import { registerTitleBarIpc } from './title-bar-ipc'
import { signInWithCopiedLink } from './copied-link'
import { DesktopNotifications } from './notifications/desktop-notifications'
import { openExternal, secureSession } from './main-window'
import { OpenAtLogin } from './open-at-login'
import { sessionPartition } from './origin'
import { preferencesFromCookies } from './preferences'
import { createSyncServices } from './services'
import { serveSettingsRenderer } from './settings-window'
import { resolveSidecar } from './sidecar'
import { TrayController } from './tray'
import { createDesktopUpdates } from './updates/electron-updates'
import type { TrayAction } from './tray-menu'
import { appIconPath, bundlePath, WindowManager } from './window-manager'
import { WindowAccount } from './window-account'
import { isSessionCookie } from './window-session'

const POLL_INTERVAL_MS = 5_000
/** Signing in or out changes several cookies at once; check the session once they settle. */
const SESSION_CHECK_DELAY_MS = 500
const PREFERENCE_COOKIES = new Set<string>(Object.values(PREFERENCE_COOKIE_NAMES))

/** Wires the windows, tray and menu to folder sync. */
export class DesktopApp {
  private readonly partition: string
  private readonly services: ReturnType<typeof createSyncServices>
  private readonly openAtLogin = new OpenAtLogin(() => this.publish())
  private readonly account: WindowAccount
  private readonly notifications: DesktopNotifications
  private readonly updates = createDesktopUpdates(
    () => this.t,
    () => this.publish()
  )
  private readonly windows: WindowManager
  private tray: TrayController | null = null
  private preferences: DesktopPreferences = {
    language: 'en',
    themeVariant: 'default',
    colorMode: 'light',
  }
  private t: Translate = createTranslator('en')
  /** Electron installs a default menu at startup, so track the language ours was built in. */
  private menuLanguage: SupportedLanguage | null = null
  private quitting = false
  private poll: NodeJS.Timeout | null = null
  private sessionCheck: NodeJS.Timeout | null = null
  private folderRequest: FolderRequest | null = null
  private folderRequests = 0

  constructor(
    private readonly origin: string,
    private readonly authOrigin: string,
    private readonly hidden: boolean
  ) {
    this.partition = sessionPartition(origin)
    this.windows = new WindowManager({
      origin,
      authOrigin,
      partition: this.partition,
      translate: () => this.t,
      surface: () => themeSurface(this.preferences),
      isQuitting: () => this.quitting,
      onSyncFolder: (target) => this.requestFolder(target),
      // Where folders can go, as of now: the user may have switched organization.
      onSyncShown: () => void this.account.refresh().catch(() => undefined),
      // An unanswered request must not open the folder picker later on its own.
      onSyncLeft: () => this.dismissFolderRequest(this.folderRequest?.id ?? -1),
    })
    const windowFetch: FetchLike = (input, init) =>
      session.fromPartition(this.partition).fetch(input, { ...init, credentials: 'include' })
    this.account = new WindowAccount(authOrigin, windowFetch, () => this.publish())
    this.services = createSyncServices({
      origin,
      authOrigin,
      userData: app.getPath('userData'),
      cookies: session.fromPartition(this.partition).cookies,
      windowFetch,
      sidecar: resolveSidecar({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        platform: process.platform,
        env: process.env,
      }),
      onSignInRequired: () => this.notifications.signInRequired(),
    })
    this.notifications = new DesktopNotifications({
      origin,
      authOrigin,
      platform: process.platform,
      windowFetch,
      settings: () => this.services.settings.value.notifications,
      translate: () => this.t,
      language: () => this.preferences.language,
      isForeground: () => BaseWindow.getFocusedWindow() !== null,
      showTeler: (path) => this.windows.showTeler(path),
      openSettings: () => this.windows.openSettings(),
    })
  }

  async start(): Promise<void> {
    const telerSession = session.fromPartition(this.partition)
    secureSession(telerSession, this.origin)
    // Development runs the stock Electron bundle; show Teler's icon in the Dock.
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(appIconPath())
    serveSettingsRenderer(bundlePath('renderer'))
    await this.loadPreferences()
    telerSession.cookies.on('changed', (_event, cookie) => {
      if (PREFERENCE_COOKIES.has(cookie.name)) void this.loadPreferences()
      if (isSessionCookie(cookie.name)) this.scheduleSessionCheck()
    })
    nativeTheme.on('updated', () => void this.loadPreferences())
    registerIpc({
      controller: this.services.controller,
      session: this.services.session,
      settingsContents: () => this.windows.settingsContents(),
      state: () => this.state(),
      chooseFolder: () => this.windows.chooseFolder(),
      revealFolder: async (path) => void (await shell.openPath(path)),
      setOpenAtLogin: (enabled) => this.openAtLogin.set(enabled),
      openTeler: (path) => this.windows.showTeler(path),
      dismissFolderRequest: (id) => this.dismissFolderRequest(id),
      setNotificationSetting: async (setting, enabled) => {
        const { settings } = this.services
        await settings.update({
          notifications: { ...settings.value.notifications, [setting]: enabled },
        })
        this.publish()
      },
    })
    registerTitleBarIpc({
      barContents: () => this.windows.barContents(),
      state: () => this.windows.titleBarState(),
      page: () => this.windows.mainContents() ?? null,
      openSettings: () => this.windows.toggleSettings(),
      openMenu: (x, y) => this.windows.popupMenu(x, y),
    })
    await this.services.settings.load()
    await this.openAtLogin.init()
    this.tray = new TrayController(bundlePath('icon.png'), process.platform, (action) =>
      this.handleTrayAction(action)
    )
    this.services.controller.onChange(() => {
      this.notifications.syncChanged(this.services.controller.status)
      this.publish()
    })
    this.notifications.start(telerSession)
    this.windows.createMain(!this.hidden)
    await this.services.watchAccess()
    await this.services.controller.init()
    // Sync follows the window's account from here on, without delaying startup.
    void this.services.session.start().catch(() => undefined)
    void this.account.refresh().catch(() => undefined)
    this.poll = setInterval(() => void this.services.controller.poll(), POLL_INTERVAL_MS)
    this.publish()
    void this.openAtLogin.askOnce(this.services.settings, this.t).catch(() => undefined)
    this.updates.start()
  }

  /** Stops sync for good; windows may close afterwards. */
  async shutdown(): Promise<void> {
    this.quitting = true
    if (this.poll) clearInterval(this.poll)
    if (this.sessionCheck) clearTimeout(this.sessionCheck)
    this.notifications.stop()
    this.updates.stop()
    await this.services.controller.shutdown()
    this.tray?.destroy()
  }

  /** A second launch: show the window, once startup has created it. */
  showMainWindow(): void {
    this.windows.showMain()
  }

  /**
   * macOS Dock activation. Electron also fires it on the first launch, so it is
   * ignored until startup finishes; a hidden launch at login stays hidden.
   */
  activate(): void {
    if (this.windows.isReady) this.windows.showMain()
  }

  private state(): DesktopState {
    const sync = this.services.controller.state
    const platform = process.platform
    return {
      origin: this.origin,
      platform: platform === 'darwin' || platform === 'win32' ? platform : 'linux',
      connection: sync.connection,
      health: sync.health,
      syncPaused: sync.syncPaused,
      openAtLogin: this.openAtLogin.enabled,
      openAtLoginAvailable: this.openAtLogin.available,
      credentialPersistence: this.services.credentials.persistence,
      folders: sync.folders,
      preferences: this.preferences,
      folderRequest: this.folderRequest,
      throttledUntil: sync.throttledUntil,
      organizations: this.account.organizations,
      activeOrganizationId: this.account.activeOrganizationId,
      notifications: this.services.settings.value.notifications,
    }
  }

  /** "Sync a folder" in the web app: open Synced folders, connecting first if needed. */
  private requestFolder(target: SyncTarget): void {
    this.folderRequest = { id: ++this.folderRequests, target }
    this.windows.openSettings()
    this.publish()
    if (this.services.controller.state.connection.status === 'disconnected')
      void this.services.session.connect()
  }

  private dismissFolderRequest(id: number): void {
    if (this.folderRequest?.id !== id) return
    this.folderRequest = null
    this.publish()
  }

  private scheduleSessionCheck(): void {
    if (this.sessionCheck) clearTimeout(this.sessionCheck)
    this.sessionCheck = setTimeout(() => {
      void this.services.session.check().catch(() => undefined)
      void this.account.refresh().catch(() => undefined)
    }, SESSION_CHECK_DELAY_MS)
  }

  private publish(): void {
    const state = this.state()
    this.tray?.update({ ...state, update: this.updates.available }, this.t)
    this.windows.sendState(state)
  }

  private async loadPreferences(): Promise<void> {
    const cookies = await session.fromPartition(this.partition).cookies.get({ url: this.origin })
    const colorMode = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    const next = preferencesFromCookies(cookies, app.getLocale(), colorMode)
    this.preferences = next
    this.t = createTranslator(next.language)
    this.windows.applySurface()
    if (next.language !== this.menuLanguage) {
      this.installMenu(next.language)
      this.windows.retitle()
    }
    this.publish()
  }

  private installMenu(language: SupportedLanguage): void {
    this.menuLanguage = language
    const contents = () => this.windows.focusedContents()
    const template = buildApplicationMenu(process.platform, this.t, {
      openSettings: () => this.windows.openSettings(),
      signInWithCopiedLink: () =>
        void signInWithCopiedLink(this.origin, this.authOrigin, this.t, (url) =>
          this.windows.openInMain(url)
        ),
      back: () => contents()?.navigationHistory.goBack(),
      forward: () => contents()?.navigationHistory.goForward(),
      reload: () => contents()?.reload(),
      openWebsite: () => openExternal('https://teler.ai'),
      checkForUpdates: () => void this.updates.checkNow(),
    })
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    app.setAboutPanelOptions(aboutPanelOptions(app.getVersion(), appIconPath(), this.t))
  }

  private handleTrayAction(action: TrayAction): void {
    const { controller } = this.services
    if (action === 'open-teler') this.windows.showTeler()
    else if (action === 'open-settings') this.windows.openSettings()
    else if (action === 'sync-folder') this.requestFolder({})
    else if (action === 'pause-sync') void controller.setSyncPaused(true)
    else if (action === 'resume-sync') void controller.setSyncPaused(false)
    else if (action === 'toggle-open-at-login') void this.openAtLogin.set(!this.openAtLogin.enabled)
    else if (action === 'install-update') void this.updates.install()
    else if (action === 'quit') app.quit()
    else {
      this.windows.openSettings()
      void this.services.session.connect()
    }
  }
}
