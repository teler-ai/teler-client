import { contextBridge, ipcRenderer } from 'electron'
import { TITLE_BAR_CHANNELS, type TitleBarApi, type TitleBarState } from '../shared/title-bar-api'

// Loaded only into the app's bundled top bar, never into remote Teler pages.
const api: TitleBarApi = {
  getState: () => ipcRenderer.invoke(TITLE_BAR_CHANNELS.getState),
  onStateChanged(listener) {
    const handler = (_event: unknown, state: TitleBarState) => listener(state)
    ipcRenderer.on(TITLE_BAR_CHANNELS.stateChanged, handler)
    return () => void ipcRenderer.removeListener(TITLE_BAR_CHANNELS.stateChanged, handler)
  },
  back: () => ipcRenderer.invoke(TITLE_BAR_CHANNELS.back),
  forward: () => ipcRenderer.invoke(TITLE_BAR_CHANNELS.forward),
  reload: () => ipcRenderer.invoke(TITLE_BAR_CHANNELS.reload),
  openSettings: () => ipcRenderer.invoke(TITLE_BAR_CHANNELS.openSettings),
  openMenu: (x, y) => ipcRenderer.invoke(TITLE_BAR_CHANNELS.openMenu, x, y),
}

contextBridge.exposeInMainWorld('telerTitleBar', api)
