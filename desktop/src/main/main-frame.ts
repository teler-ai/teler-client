import { BaseWindow, WebContentsView, type WebContents } from 'electron'
import type { DesktopState } from '../shared/desktop-api'
import { TITLE_BAR_CHANNELS, type TitleBarState } from '../shared/title-bar-api'
import type { ThemeSurface } from './branding'
import { attachContextMenu } from './context-menu'
import type { Translate } from './i18n'
import { APP_ENTRY_URL, offlinePageUrl } from './local-pages'
import { createLocalView } from './local-view'
import { applyNavigationPolicy, REMOTE_WEB_PREFERENCES } from './main-window'
import { decideMainNavigation } from './navigation-policy'
import {
  frameOptions,
  titleBarOverlay,
  titleBarState,
  TITLE_BAR_URL,
  viewBounds,
  type NavigationState,
} from './title-bar'

const ABORTED_LOAD = -3

export interface MainFrameOptions {
  origin: string
  /** Sign-in origin; the same as `origin` unless `TELER_AUTH_URL` overrides it. */
  authOrigin: string
  partition: string
  platform: DesktopState['platform']
  surface: ThemeSurface
  icon: string | undefined
  /** The top bar's preload, which exposes `window.telerTitleBar`. */
  preload: string
  /** The Synced folders page's preload, which exposes `window.telerDesktop`. */
  syncPreload: string
  show: boolean
  translate(): Translate
  /** The window went back from Synced folders to the Teler page. */
  onLeaveSync(): void
}

export type MainView = TitleBarState['view']

/**
 * The main window: the app's own top bar (a bundled page) above either the
 * remote Teler page or the bundled Synced folders page. Only the local pages
 * get a preload; the Teler page keeps the remote sandbox and navigation policy.
 */
export class MainFrame {
  readonly window: BaseWindow
  readonly contents: WebContents
  readonly bar: WebContents
  private readonly page: WebContentsView
  private readonly barView: WebContentsView
  private sync: WebContentsView | null = null
  private shown: MainView = 'teler'
  private surface: ThemeSurface
  private desktop: DesktopState | null = null
  private fullScreen = false

  constructor(
    private readonly options: MainFrameOptions,
    url: string
  ) {
    this.window = new BaseWindow({
      width: 1280,
      height: 860,
      minWidth: 480,
      minHeight: 480,
      show: false,
      title: 'Teler',
      backgroundColor: options.surface.background,
      ...(options.icon ? { icon: options.icon } : {}),
      ...frameOptions(options.platform, options.surface),
    })
    this.surface = options.surface
    const content = new WebContentsView({
      webPreferences: { ...REMOTE_WEB_PREFERENCES, partition: options.partition, spellcheck: true },
    })
    content.setBackgroundColor(options.surface.background)
    const bar = createLocalView({
      preload: options.preload,
      background: options.surface.background,
      fixed: true,
    })
    this.page = content
    this.barView = bar
    this.contents = content.webContents
    this.bar = bar.webContents
    for (const view of [content, bar]) this.window.contentView.addChildView(view)
    this.layout()
    this.window.on('resize', () => this.layout())
    // Full screen hides the macOS traffic lights, so the bar needs less room.
    this.window.on('enter-full-screen', () => this.setFullScreen(true))
    this.window.on('leave-full-screen', () => this.setFullScreen(false))
    // Views outlive their window unless closed with it.
    this.window.on('closed', () => {
      for (const contents of [this.contents, this.bar, this.sync?.webContents])
        if (contents && !contents.isDestroyed()) contents.close()
    })
    this.guardContent()
    if (options.show)
      this.bar.once('did-finish-load', () => {
        this.window.show()
        // Keyboard input goes to the Teler page, not the bar.
        this.contents.focus()
      })
    void this.bar.loadURL(TITLE_BAR_URL)
    void this.contents.loadURL(url)
  }

  get navigation(): NavigationState {
    return {
      canGoBack: this.contents.navigationHistory.canGoBack(),
      canGoForward: this.contents.navigationHistory.canGoForward(),
      loading: this.contents.isLoading(),
    }
  }

  /** The bar's state, once the app has published its first state. */
  get barState(): TitleBarState | null {
    return this.desktop && titleBarState(this.desktop, this.navigation, this.fullScreen, this.shown)
  }

  get view(): MainView {
    return this.shown
  }

  /** The Synced folders page, once it has been shown. */
  get syncContents(): WebContents | null {
    const contents = this.sync?.webContents
    return contents && !contents.isDestroyed() ? contents : null
  }

  /** Shows the Synced folders page in place of the Teler page. */
  showSync(): void {
    if (!this.sync) {
      this.sync = this.createSyncPage()
      // Sized once assigned: layout() sizes the views it knows.
      this.layout()
    }
    this.sync.setVisible(true)
    this.page.setVisible(false)
    this.shown = 'sync'
    this.window.setTitle(this.options.translate()('settings.windowTitle'))
    this.sync.webContents.focus()
    this.pushBar()
  }

  /** Shows the Teler page again. */
  showTeler(): void {
    if (this.shown === 'teler') return
    this.sync?.setVisible(false)
    this.page.setVisible(true)
    this.shown = 'teler'
    this.window.setTitle(this.contents.getTitle() || 'Teler')
    this.contents.focus()
    this.pushBar()
    this.options.onLeaveSync()
  }

  /** The page shown under the bar: Teler or Synced folders. */
  get shownContents(): WebContents {
    return this.shown === 'sync' && this.sync ? this.sync.webContents : this.contents
  }

  retitle(): void {
    if (this.shown === 'sync')
      this.window.setTitle(this.options.translate()('settings.windowTitle'))
  }

  setDesktopState(state: DesktopState): void {
    this.desktop = state
    this.pushBar()
  }

  applySurface(surface: ThemeSurface): void {
    this.surface = surface
    this.window.setBackgroundColor(surface.background)
    this.sync?.setBackgroundColor(surface.background)
    if (this.options.platform !== 'darwin') this.window.setTitleBarOverlay(titleBarOverlay(surface))
  }

  private setFullScreen(fullScreen: boolean): void {
    this.fullScreen = fullScreen
    this.pushBar()
  }

  private pushBar(): void {
    const state = this.barState
    if (state && !this.bar.isDestroyed()) this.bar.send(TITLE_BAR_CHANNELS.stateChanged, state)
  }

  private layout(): void {
    const { width, height } = this.window.getContentBounds()
    const bounds = viewBounds(width, height)
    this.barView.setBounds(bounds.bar)
    this.page.setBounds(bounds.content)
    this.sync?.setBounds(bounds.content)
  }

  private createSyncPage(): WebContentsView {
    const view = createLocalView({
      preload: this.options.syncPreload,
      background: this.surface.background,
      fixed: false,
      translate: this.options.translate,
    })
    this.window.contentView.addChildView(view)
    // Keep the localized title rather than the page's static <title>.
    view.webContents.on('page-title-updated', (event) => event.preventDefault())
    void view.webContents.loadURL(APP_ENTRY_URL)
    return view
  }

  private guardContent(): void {
    const { origin, authOrigin, translate } = this.options
    const contents = this.contents
    attachContextMenu(contents, translate)
    applyNavigationPolicy(
      contents,
      origin,
      (url) => decideMainNavigation(url, origin, authOrigin),
      authOrigin
    )
    contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== ABORTED_LOAD)
        void contents.loadURL(offlinePageUrl(origin, translate()))
    })
    let lastCrash = 0
    contents.on('render-process-gone', () => {
      // Reload once per minute at most so a page that crashes repeatedly cannot loop.
      if (Date.now() - lastCrash < 60_000) return
      lastCrash = Date.now()
      contents.reload()
    })
    contents.on('page-title-updated', (_event, title) => {
      if (this.shown === 'teler') this.window.setTitle(title || 'Teler')
    })
    // Back, forward and loading in the bar follow the page.
    contents.on('did-navigate', () => this.pushBar())
    contents.on('did-navigate-in-page', () => this.pushBar())
    contents.on('did-start-loading', () => this.pushBar())
    contents.on('did-stop-loading', () => this.pushBar())
  }
}
