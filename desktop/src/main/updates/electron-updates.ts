import { app, dialog, Notification } from 'electron'
import type { Translate } from '../i18n'
import { openExternal } from '../main-window'
import { DesktopUpdates } from './desktop-updates'

/** Update checks wired to Electron's notifications, dialogs and the default browser. */
export function createDesktopUpdates(translate: () => Translate, onChange: () => void) {
  // A notification must stay referenced, or its click handler can be collected.
  let shown: Notification | null = null
  return new DesktopUpdates({
    currentVersion: app.getVersion(),
    installation: {
      platform: process.platform,
      arch: process.arch,
      appImage: Boolean(process.env.APPIMAGE),
    },
    automatic: app.isPackaged && !process.env.TELER_NO_UPDATE_CHECK?.trim(),
    translate,
    onChange,
    notify: (title, body, onClick) => {
      if (!Notification.isSupported()) return
      shown?.close()
      shown = new Notification({ title, body })
      shown.on('click', onClick)
      shown.show()
    },
    ask: async ({ kind, title, detail, buttons }) => {
      const { response } = await dialog.showMessageBox({
        type: kind,
        message: title,
        detail,
        buttons,
        defaultId: 0,
        cancelId: buttons.length - 1,
        noLink: true,
      })
      return response
    },
    openExternal,
  })
}
