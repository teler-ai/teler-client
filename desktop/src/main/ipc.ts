import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  DESKTOP_CHANNELS,
  type DesktopState,
  type NotificationSetting,
} from '../shared/desktop-api'
import { isSettingsUrl } from './settings-window'
import type { SyncController } from './sync-controller'
import type { SyncSession } from './sync-session'
import { ORGANIZATION_ID, PROJECT_ID } from './sync-target'

const idSchema = z.string().min(1).max(200)
const folderSchema = z.object({
  localPath: z.string().min(1).max(4096),
  destination: z.string().min(1).max(1024),
  organizationId: z.string().regex(ORGANIZATION_ID).optional(),
  projectId: z.string().regex(PROJECT_ID).optional(),
  projectName: z.string().trim().min(1).max(200).optional(),
})
const pathSchema = z.string().startsWith('/').max(2048).optional()
const notificationSettingSchema = z.tuple([
  z.enum(['files', 'folders', 'problems', 'chats', 'alerts', 'sound']),
  z.boolean(),
])

export interface IpcDeps {
  controller: SyncController
  /** Connecting and disconnecting, which sync then follows across sign-ins. */
  session: SyncSession
  /** The Synced folders page's contents, if open: the only accepted sender. */
  settingsContents(): Electron.WebContents | null
  state(): DesktopState
  chooseFolder(): Promise<string | null>
  revealFolder(path: string): Promise<void>
  setOpenAtLogin(enabled: boolean): Promise<void>
  openTeler(path?: string): void
  dismissFolderRequest(id: number): void
  setNotificationSetting(setting: NotificationSetting, enabled: boolean): Promise<void>
}

/**
 * Every handler rejects callers other than the bundled Synced folders page and
 * validates its payload; the renderer is treated as untrusted input.
 */
export function registerIpc(deps: IpcDeps): void {
  const trusted = (event: IpcMainInvokeEvent) =>
    event.sender === deps.settingsContents() && isSettingsUrl(event.senderFrame?.url)
  const handle = <T>(channel: string, run: (...payload: unknown[]) => Promise<T> | T) =>
    ipcMain.handle(channel, (event, ...payload: unknown[]) => {
      if (!trusted(event)) throw new Error('Untrusted sender')
      return run(...payload)
    })
  const { controller } = deps

  handle(DESKTOP_CHANNELS.getState, () => deps.state())
  handle(DESKTOP_CHANNELS.connect, () => deps.session.connect())
  handle(DESKTOP_CHANNELS.disconnect, () => deps.session.disconnect())
  handle(DESKTOP_CHANNELS.chooseFolder, () => deps.chooseFolder())
  handle(DESKTOP_CHANNELS.previewFolder, (payload) =>
    controller.preview(folderSchema.parse(payload))
  )
  handle(DESKTOP_CHANNELS.addFolder, (payload) => controller.add(folderSchema.parse(payload)))
  handle(DESKTOP_CHANNELS.pauseFolder, (payload) => controller.pause(idSchema.parse(payload)))
  handle(DESKTOP_CHANNELS.resumeFolder, (payload) => controller.resume(idSchema.parse(payload)))
  handle(DESKTOP_CHANNELS.removeFolder, (payload) => controller.remove(idSchema.parse(payload)))
  handle(DESKTOP_CHANNELS.retryFolder, (payload) => controller.retry(idSchema.parse(payload)))
  handle(DESKTOP_CHANNELS.revealFolder, async (payload) => {
    const path = controller.folderPath(idSchema.parse(payload))
    if (path) await deps.revealFolder(path)
  })
  handle(DESKTOP_CHANNELS.setSyncPaused, (payload) =>
    controller.setSyncPaused(z.boolean().parse(payload))
  )
  handle(DESKTOP_CHANNELS.setOpenAtLogin, (payload) =>
    deps.setOpenAtLogin(z.boolean().parse(payload))
  )
  handle(DESKTOP_CHANNELS.openTeler, (payload) => deps.openTeler(pathSchema.parse(payload)))
  handle(DESKTOP_CHANNELS.setNotificationSetting, (...args) => {
    const [setting, enabled] = notificationSettingSchema.parse(args)
    return deps.setNotificationSetting(setting, enabled)
  })
  handle(DESKTOP_CHANNELS.dismissFolderRequest, (payload) =>
    deps.dismissFolderRequest(z.number().int().nonnegative().parse(payload))
  )
}
