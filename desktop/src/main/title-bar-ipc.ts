import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { z } from 'zod'
import { TITLE_BAR_CHANNELS, type TitleBarState } from '../shared/title-bar-api'
import { isTitleBarUrl } from './title-bar'

const pointSchema = z.tuple([
  z.number().finite().min(0).max(100_000),
  z.number().finite().min(0).max(100_000),
])

export interface TitleBarIpcDeps {
  /** The main window's bar, if open: the only accepted sender. */
  barContents(): WebContents | null
  state(): TitleBarState | null
  /** The Teler page that back, forward and reload act on. */
  page(): WebContents | null
  openSettings(): void
  openMenu(x: number, y: number): void
}

/** The bar's handlers accept only the bundled bar page and validate their payloads. */
export function registerTitleBarIpc(deps: TitleBarIpcDeps): void {
  const trusted = (event: IpcMainInvokeEvent) =>
    event.sender === deps.barContents() && isTitleBarUrl(event.senderFrame?.url)
  const handle = (channel: string, run: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!trusted(event)) throw new Error('Untrusted sender')
      return run(...args)
    })

  handle(TITLE_BAR_CHANNELS.getState, () => {
    const state = deps.state()
    if (!state) throw new Error('The app has not started yet')
    return state
  })
  // The bar's buttons act on the Teler page and give it the keyboard back.
  const onPage = (act: (page: WebContents) => void) => () => {
    const page = deps.page()
    if (!page) return
    act(page)
    page.focus()
  }
  handle(
    TITLE_BAR_CHANNELS.back,
    onPage((page) => page.navigationHistory.goBack())
  )
  handle(
    TITLE_BAR_CHANNELS.forward,
    onPage((page) => page.navigationHistory.goForward())
  )
  handle(
    TITLE_BAR_CHANNELS.reload,
    onPage((page) => page.reload())
  )
  handle(TITLE_BAR_CHANNELS.openSettings, () => deps.openSettings())
  handle(TITLE_BAR_CHANNELS.openMenu, (...point) => {
    const [x, y] = pointSchema.parse(point)
    deps.openMenu(x, y)
  })
}
