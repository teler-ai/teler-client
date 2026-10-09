import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_CHANNELS, type DesktopApi, type DesktopState } from '../shared/desktop-api'

// Loaded only into the bundled Synced folders page, never into remote Teler pages.
const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getState),
  onStateChanged(listener) {
    const handler = (_event: unknown, state: DesktopState) => listener(state)
    ipcRenderer.on(DESKTOP_CHANNELS.stateChanged, handler)
    return () => void ipcRenderer.removeListener(DESKTOP_CHANNELS.stateChanged, handler)
  },
  connect: () => ipcRenderer.invoke(DESKTOP_CHANNELS.connect),
  disconnect: () => ipcRenderer.invoke(DESKTOP_CHANNELS.disconnect),
  chooseFolder: () => ipcRenderer.invoke(DESKTOP_CHANNELS.chooseFolder),
  previewFolder: (input) => ipcRenderer.invoke(DESKTOP_CHANNELS.previewFolder, input),
  addFolder: (input) => ipcRenderer.invoke(DESKTOP_CHANNELS.addFolder, input),
  pauseFolder: (id) => ipcRenderer.invoke(DESKTOP_CHANNELS.pauseFolder, id),
  resumeFolder: (id) => ipcRenderer.invoke(DESKTOP_CHANNELS.resumeFolder, id),
  removeFolder: (id) => ipcRenderer.invoke(DESKTOP_CHANNELS.removeFolder, id),
  revealFolder: (id) => ipcRenderer.invoke(DESKTOP_CHANNELS.revealFolder, id),
  setSyncPaused: (paused) => ipcRenderer.invoke(DESKTOP_CHANNELS.setSyncPaused, paused),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke(DESKTOP_CHANNELS.setOpenAtLogin, enabled),
  openTeler: (path) => ipcRenderer.invoke(DESKTOP_CHANNELS.openTeler, path),
  retryFolder: (id) => ipcRenderer.invoke(DESKTOP_CHANNELS.retryFolder, id),
  setNotificationSetting: (setting, enabled) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.setNotificationSetting, setting, enabled),
  dismissFolderRequest: (id) => ipcRenderer.invoke(DESKTOP_CHANNELS.dismissFolderRequest, id),
}

contextBridge.exposeInMainWorld('telerDesktop', api)
