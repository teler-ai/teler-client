import { join } from 'node:path'
import { app, BaseWindow, BrowserWindow, dialog, Menu, type WebContents } from 'electron'
import { DESKTOP_CHANNELS, type DesktopState, type SyncTarget } from '../shared/desktop-api'
import { windowIcon, type ThemeSurface } from './branding'
import type { Translate } from './i18n'
import { MainFrame } from './main-frame'
import { isTelerPage, parseSyncFolderAction } from './sync-target'

/** A file in the bundled app (`dist/`), inside the asar archive when packaged. */
export function bundlePath(...segments: string[]): string {
  return join(app.getAppPath(), 'dist', ...segments)
}

/** The Teler icon as a plain file; GTK cannot read inside the asar archive. */
export function appIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : bundlePath('icon.png')
}

export interface WindowManagerOptions {
  origin: string
  authOrigin: string
  partition: string
  translate(): Translate
  /** The current theme's colours, shown before a page paints. */
  surface(): ThemeSurface
  isQuitting(): boolean
  /** "Sync a folder" from a Teler page in the main window. */
  onSyncFolder(target: SyncTarget): void
  /** The main window showed the Synced folders page. */
  onSyncShown(): void
  /** The main window went back from Synced folders to Teler. */
  onSyncLeft(): void
}

/** The main window: the Teler page, or the Synced folders page, under the app's top bar. */
export class WindowManager {
  private main: MainFrame | null = null
  /** The last published app state, for a bar created later. */
  private state: DesktopState | null = null
  private ready = false
  private showRequested = false
  private readonly icon: string | undefined

  constructor(private readonly options: WindowManagerOptions) {
    this.icon = windowIcon(process.platform, app.isPackaged, appIconPath())
  }

  get isReady(): boolean {
    return this.ready
  }

  /** Creates the main window when startup finishes, shown unless launched hidden. */
  createMain(show: boolean): void {
    this.main = this.createMainWindow(show || this.showRequested)
    this.ready = true
  }

  /**
   * Shows the main window, optionally at a same-origin path. A request that
   * arrives during startup (a second launch) is applied once the window exists.
   */
  showMain(path?: string): void {
    if (!this.ready) {
      this.showRequested = true
      return
    }
    if (!this.main || this.main.window.isDestroyed()) this.main = this.createMainWindow(false)
    const target = path ? new URL(path, this.options.origin) : null
    if (target?.origin === this.options.origin) void this.main.contents.loadURL(target.toString())
    const { window } = this.main
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    this.main.shownContents.focus()
  }

  /** Shows the Teler page of the main window, optionally at a same-origin path. */
  showTeler(path?: string): void {
    this.showMain(path)
    this.main?.showTeler()
  }

  /** Loads an already validated same-origin URL, such as a copied sign-in link. */
  openInMain(url: string): void {
    this.showTeler()
    void this.main?.contents.loadURL(url)
  }

  /** Shows Synced folders: a page of the main window, not a window of its own. */
  openSettings(): void {
    this.showMain()
    if (!this.main) return
    this.main.showSync()
    this.options.onSyncShown()
  }

  /** The top bar's sync status: Synced folders, or back to Teler when it is open. */
  toggleSettings(): void {
    if (this.main?.view === 'sync') this.main.showTeler()
    else this.openSettings()
  }

  /** Applies the current language to the app-owned window titles. */
  retitle(): void {
    if (this.main && !this.main.window.isDestroyed()) this.main.retitle()
  }

  /** Matches the window backgrounds to the current theme. */
  applySurface(): void {
    if (this.main && !this.main.window.isDestroyed()) this.main.applySurface(this.options.surface())
  }

  /** The page shown in the focused window: the main window's page, or a popup's. */
  focusedContents(): WebContents | undefined {
    const focused = BaseWindow.getFocusedWindow()
    if (this.main && focused === this.main.window) return this.main.shownContents
    return focused instanceof BrowserWindow ? focused.webContents : undefined
  }

  /** The main window's Teler page, for the top bar's navigation buttons. */
  mainContents(): WebContents | undefined {
    return this.main && !this.main.window.isDestroyed() ? this.main.contents : undefined
  }

  barContents(): WebContents | null {
    return this.main && !this.main.window.isDestroyed() ? this.main.bar : null
  }

  titleBarState() {
    return this.main?.barState ?? null
  }

  /** Windows and Linux: the application menu, from the top bar's menu button. */
  popupMenu(x: number, y: number): void {
    if (!this.main || this.main.window.isDestroyed()) return
    Menu.getApplicationMenu()?.popup({
      window: this.main.window,
      x: Math.round(x),
      y: Math.round(y),
    })
  }

  /** The Synced folders page, once shown: the only sender the desktop IPC accepts. */
  settingsContents(): Electron.WebContents | null {
    return this.main && !this.main.window.isDestroyed() ? this.main.syncContents : null
  }

  sendState(state: DesktopState): void {
    this.state = state
    this.settingsContents()?.send(DESKTOP_CHANNELS.stateChanged, state)
    if (this.main && !this.main.window.isDestroyed()) this.main.setDesktopState(state)
  }

  async chooseFolder(): Promise<string | null> {
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    }
    const parent = this.main && !this.main.window.isDestroyed() ? this.main.window : null
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  }

  private createMainWindow(show: boolean): MainFrame {
    const platform = process.platform
    const frame = new MainFrame(
      {
        origin: this.options.origin,
        authOrigin: this.options.authOrigin,
        partition: this.options.partition,
        platform: platform === 'darwin' || platform === 'win32' ? platform : 'linux',
        surface: this.options.surface(),
        icon: this.icon,
        preload: bundlePath('preload', 'title-bar.cjs'),
        syncPreload: bundlePath('preload', 'settings.cjs'),
        show,
        translate: this.options.translate,
        onLeaveSync: () => this.options.onSyncLeft(),
      },
      `${this.options.origin}/`
    )
    if (this.state) frame.setDesktopState(this.state)
    frame.contents.on('will-navigate', (event) => {
      const target = parseSyncFolderAction(event.url)
      if (!target) return
      event.preventDefault()
      if (isTelerPage(frame.contents.getURL(), this.options.origin))
        this.options.onSyncFolder(target)
    })
    // Closing the window keeps Teler and folder sync running in the tray.
    frame.window.on('close', (event) => {
      if (this.options.isQuitting()) return
      event.preventDefault()
      frame.window.hide()
    })
    return frame
  }
}
