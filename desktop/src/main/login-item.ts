import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Command-line flag for launches at login: start in the tray without a window. */
export const HIDDEN_LAUNCH_FLAG = '--hidden'
const AUTOSTART_FILE = 'ai.teler.desktop.desktop'
const LOGIN_ARGS = [HIDDEN_LAUNCH_FLAG]

// Desktop Entry Exec quoting: wrap in quotes and escape ", `, $ and \.
function quoteExecArgument(value: string): string {
  return `"${value.replace(/(["`$\\])/g, '\\$1')}"`
}

// Desktop Entry string values escape backslashes and line breaks.
function entryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
}

/** `comments` is keyed by language code and must include `en`. */
export function linuxAutostartEntry(
  executable: string,
  comments: Readonly<Record<string, string>>
): string {
  const localized = Object.entries(comments)
    .filter(([language]) => language !== 'en')
    .map(([language, comment]) => `Comment[${language}]=${entryValue(comment)}`)
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Teler',
    `Comment=${entryValue(comments.en ?? 'Teler')}`,
    ...localized,
    `Exec=${quoteExecArgument(executable)} ${HIDDEN_LAUNCH_FLAG}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n')
}

export interface LoginItemSettingsApi {
  getLoginItemSettings(options?: { args?: string[] }): { openAtLogin: boolean }
  setLoginItemSettings(settings: { openAtLogin: boolean; args?: string[] }): void
}

export interface LoginItemDeps {
  platform: NodeJS.Platform
  app: LoginItemSettingsApi
  env: NodeJS.ProcessEnv
  execPath: string
  homeDir: string
  /** Autostart entry description by language (Linux). */
  comments: Readonly<Record<string, string>>
}

export interface LoginItems {
  isEnabled(): Promise<boolean>
  setEnabled(enabled: boolean): Promise<void>
}

/**
 * macOS and Windows use the system login items. Linux has no Electron API,
 * so an XDG autostart entry points at the AppImage or installed executable.
 */
export function createLoginItems(deps: LoginItemDeps): LoginItems {
  if (deps.platform !== 'linux') {
    return {
      async isEnabled() {
        // Windows matches the registered command line, arguments included.
        return deps.app.getLoginItemSettings({ args: LOGIN_ARGS }).openAtLogin
      },
      async setEnabled(enabled) {
        deps.app.setLoginItemSettings({ openAtLogin: enabled, args: LOGIN_ARGS })
      },
    }
  }
  const configHome = deps.env.XDG_CONFIG_HOME?.trim() || join(deps.homeDir, '.config')
  const directory = join(configHome, 'autostart')
  const file = join(directory, AUTOSTART_FILE)
  return {
    async isEnabled() {
      return stat(file).then(
        () => true,
        () => false
      )
    },
    async setEnabled(enabled) {
      if (!enabled) return rm(file, { force: true })
      const executable = deps.env.APPIMAGE?.trim() || deps.execPath
      await mkdir(directory, { recursive: true })
      await writeFile(file, linuxAutostartEntry(executable, deps.comments), { mode: 0o644 })
    },
  }
}
