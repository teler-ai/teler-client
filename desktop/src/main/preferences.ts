import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  COLOR_MODES,
  THEME_VARIANTS,
  type ColorMode,
  type ThemeVariant,
} from '../shared/appearance'
import { z } from 'zod'
import type { DesktopPreferences } from '../shared/desktop-api'
import { getSupportedLanguage } from '../shared/languages'
import { PREFERENCE_COOKIE_NAMES } from '../shared/preference-cookies'

interface CookieLike {
  name: string
  value: string
}

function includes<T extends string>(values: readonly T[], value: string | undefined): value is T {
  return value !== undefined && (values as readonly string[]).includes(value)
}

/**
 * The local windows follow the user's Teler language and theme, which the web
 * app keeps in preference cookies on the Teler origin.
 */
export function preferencesFromCookies(
  cookies: readonly CookieLike[],
  systemLanguage: string,
  systemColorMode: ColorMode
): DesktopPreferences {
  const read = (name: string) => cookies.find((cookie) => cookie.name === name)?.value
  const language = read(PREFERENCE_COOKIE_NAMES.language)
  const variant = read(PREFERENCE_COOKIE_NAMES.themeVariant)
  const colorMode = read(PREFERENCE_COOKIE_NAMES.colorMode)
  return {
    language: getSupportedLanguage(language ?? systemLanguage),
    themeVariant: includes<ThemeVariant>(THEME_VARIANTS, variant) ? variant : 'default',
    colorMode: includes<ColorMode>(COLOR_MODES, colorMode) ? colorMode : systemColorMode,
  }
}

const settingsSchema = z.object({
  version: z.literal(1),
  syncPaused: z.boolean(),
  /** Whether the first-launch open-at-login question was answered. */
  openAtLoginInitialized: z.boolean(),
  /** Reconnect sync when someone signs in to the window; off after an explicit disconnect. */
  autoConnect: z.boolean().default(false),
  /** Names of the projects folders were added into, by registration ID. */
  folderProjects: z.record(z.string(), z.string().max(200)).default({}),
  notifications: z
    .object({
      files: z.boolean().default(true),
      folders: z.boolean().default(true),
      problems: z.boolean().default(true),
      chats: z.boolean().default(true),
      alerts: z.boolean().default(true),
      sound: z.boolean().default(true),
    })
    .default({
      files: true,
      folders: true,
      problems: true,
      chats: true,
      alerts: true,
      sound: true,
    }),
})

export type DesktopSettings = Omit<z.infer<typeof settingsSchema>, 'version'>

const DEFAULT_SETTINGS: DesktopSettings = {
  syncPaused: false,
  openAtLoginInitialized: false,
  autoConnect: false,
  folderProjects: {},
  notifications: {
    files: true,
    folders: true,
    problems: true,
    chats: true,
    alerts: true,
    sound: true,
  },
}

export class SettingsStore {
  private current: DesktopSettings = DEFAULT_SETTINGS

  constructor(private readonly file: string) {}

  get value(): DesktopSettings {
    return this.current
  }

  async load(): Promise<DesktopSettings> {
    try {
      const parsed = settingsSchema.safeParse(JSON.parse(await readFile(this.file, 'utf8')))
      if (parsed.success) {
        const { version: _version, ...settings } = parsed.data
        this.current = settings
      }
    } catch {
      // First launch or unreadable settings: keep defaults.
    }
    return this.current
  }

  async update(patch: Partial<DesktopSettings>): Promise<DesktopSettings> {
    this.current = { ...this.current, ...patch }
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, `${JSON.stringify({ version: 1, ...this.current }, null, 2)}\n`)
    return this.current
  }
}
