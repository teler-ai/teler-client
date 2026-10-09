import { app, dialog } from 'electron'
import { getSupportedLanguage } from '../shared/languages'
import { desktopUserAgent } from './branding'
import { DesktopApp } from './desktop-app'
import { createTranslator } from './i18n'
import { HIDDEN_LAUNCH_FLAG } from './login-item'
import { resolveAuthOrigin, resolveTelerOrigin } from './origin'
import { registerAppScheme } from './settings-window'

const APP_USER_MODEL_ID = 'ai.teler.desktop'

function launchedHidden(): boolean {
  if (process.argv.includes(HIDDEN_LAUNCH_FLAG)) return true
  return process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin
}

function run(origin: string, authOrigin: string): void {
  let desktop: DesktopApp | null = null
  let stopped = false
  app.on('second-instance', () => desktop?.showMainWindow())
  // macOS: clicking the Dock icon reopens the window.
  app.on('activate', () => desktop?.activate())
  // Closing every window keeps Teler running in the tray.
  app.on('window-all-closed', () => undefined)
  app.on('before-quit', (event) => {
    if (stopped || !desktop) return
    event.preventDefault()
    void desktop.shutdown().finally(() => {
      stopped = true
      app.quit()
    })
  })
  void app
    .whenReady()
    .then(async () => {
      desktop = new DesktopApp(origin, authOrigin, launchedHidden())
      await desktop.start()
    })
    .catch(async (error: unknown) => {
      // Local diagnostics only; startup errors carry no credentials.
      console.error('Teler failed to start:', error)
      // A process without windows would hold the single-instance lock forever.
      await desktop?.shutdown().catch(() => undefined)
      const t = createTranslator(getSupportedLanguage(app.getLocale()))
      dialog.showErrorBox('Teler', t('startup.failed'))
      app.exit(1)
    })
}

registerAppScheme()
app.userAgentFallback = desktopUserAgent(app.userAgentFallback, app.name, app.getVersion())
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  try {
    const origin = resolveTelerOrigin(process.env.TELER_URL)
    run(origin, resolveAuthOrigin(process.env.TELER_AUTH_URL, origin))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid configuration'
    void app.whenReady().then(() => {
      dialog.showErrorBox('Teler', message)
      app.quit()
    })
  }
}
