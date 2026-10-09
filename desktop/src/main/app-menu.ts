import type { MenuItemConstructorOptions } from 'electron'
import type { Translate } from './i18n'

export interface MenuActions {
  openSettings(): void
  signInWithCopiedLink(): void
  back(): void
  forward(): void
  reload(): void
  openWebsite(): void
  checkForUpdates(): void
}

/**
 * The application menu. Edit shortcuts (copy, paste, undo) only work in
 * Electron when an Edit menu exists, so it is always present.
 */
export function buildApplicationMenu(
  platform: NodeJS.Platform,
  t: Translate,
  actions: MenuActions
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin'
  const syncedFolders: MenuItemConstructorOptions = {
    label: t('menu.syncedFolders'),
    accelerator: 'CmdOrCtrl+,',
    click: actions.openSettings,
  }
  const checkForUpdates: MenuItemConstructorOptions = {
    label: t('menu.checkForUpdates'),
    click: actions.checkForUpdates,
  }
  const appMenu: MenuItemConstructorOptions[] = mac
    ? [
        {
          label: 'Teler',
          submenu: [
            { role: 'about', label: t('menu.about') },
            checkForUpdates,
            { type: 'separator' },
            syncedFolders,
            { type: 'separator' },
            { role: 'hide', label: t('menu.hide') },
            { role: 'hideOthers', label: t('menu.hideOthers') },
            { role: 'unhide', label: t('menu.showAll') },
            { type: 'separator' },
            { role: 'quit', label: t('menu.quit') },
          ],
        },
      ]
    : []
  return [
    ...appMenu,
    {
      label: t('menu.file'),
      submenu: [
        ...(mac ? [] : [syncedFolders, { type: 'separator' } as const]),
        { label: t('menu.signInWithLink'), click: actions.signInWithCopiedLink },
        { type: 'separator' },
        { role: 'close', label: t('menu.close') },
        ...(mac ? [] : [{ role: 'quit', label: t('menu.quit') } as const]),
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'selectAll', label: t('menu.selectAll') },
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        { label: t('menu.back'), accelerator: 'CmdOrCtrl+[', click: actions.back },
        { label: t('menu.forward'), accelerator: 'CmdOrCtrl+]', click: actions.forward },
        { label: t('menu.reload'), accelerator: 'CmdOrCtrl+R', click: actions.reload },
        { type: 'separator' },
        { role: 'resetZoom', label: t('menu.actualSize') },
        { role: 'zoomIn', label: t('menu.zoomIn') },
        { role: 'zoomOut', label: t('menu.zoomOut') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('menu.toggleFullScreen') },
      ],
    },
    {
      label: t('menu.window'),
      role: 'windowMenu',
      submenu: [
        { role: 'minimize', label: t('menu.minimize') },
        { role: 'zoom', label: t('menu.zoom') },
      ],
    },
    {
      label: t('menu.help'),
      role: 'help',
      submenu: [
        { label: t('menu.website'), click: actions.openWebsite },
        // macOS keeps About and updates in the app menu.
        ...(mac
          ? []
          : [
              checkForUpdates,
              { type: 'separator' } as const,
              { role: 'about', label: t('menu.about') } as const,
            ]),
      ],
    },
  ]
}
