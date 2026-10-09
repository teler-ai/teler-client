import { app, dialog } from 'electron'
import type { Translate } from './i18n'
import { createLoginItems, type LoginItems } from './login-item'
import { localizedSystemString } from './system-strings'

interface FirstRunSettings {
  value: { openAtLoginInitialized: boolean }
  update(patch: { openAtLoginInitialized: boolean }): Promise<unknown>
}

/**
 * Opening Teler at login. Only the installed app can be a login item: a
 * development run is the stock Electron binary, which would open "Electron".
 */
export class OpenAtLogin {
  private readonly loginItems: LoginItems
  private current = false

  constructor(private readonly onChange: () => void) {
    this.loginItems = createLoginItems({
      platform: process.platform,
      app,
      env: process.env,
      execPath: process.execPath,
      homeDir: app.getPath('home'),
      comments: localizedSystemString('system.appDescription'),
    })
  }

  get available(): boolean {
    return app.isPackaged
  }

  get enabled(): boolean {
    return this.current
  }

  async init(): Promise<void> {
    this.current = this.available && (await this.loginItems.isEnabled().catch(() => false))
  }

  async set(enabled: boolean): Promise<void> {
    if (!this.available) return
    await this.loginItems.setEnabled(enabled)
    this.current = await this.loginItems.isEnabled()
    this.onChange()
  }

  /**
   * Asks once, on the first launch after installing (a DMG or AppImage has no
   * installer step). Opening at login is the default answer; until the user
   * answers, the next launch asks again.
   */
  async askOnce(settings: FirstRunSettings, t: Translate): Promise<void> {
    if (!this.available || settings.value.openAtLoginInitialized) return
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: [t('tray.openAtLogin'), t('firstRun.openAtLogin.skip')],
      defaultId: 0,
      cancelId: 1,
      title: 'Teler',
      message: t('firstRun.openAtLogin.title'),
      detail: t('firstRun.openAtLogin.detail'),
    })
    // Recorded only once applied; if the login item cannot be set, ask again next launch.
    await this.set(response === 0)
    await settings.update({ openAtLoginInitialized: true })
  }
}
