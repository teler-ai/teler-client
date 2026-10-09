import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../shared/languages'
import { MAIN_CATALOGS, type MessageKey } from './i18n'

/** Copy the operating system shows for the app: permission prompts, launcher entries. */
export type SystemStringKey = Extract<MessageKey, `system.${string}`>

export function localizedSystemString(key: SystemStringKey): Record<SupportedLanguage, string> {
  const english = MAIN_CATALOGS.en[key] ?? ''
  const translated = (language: SupportedLanguage) => MAIN_CATALOGS[language][key] ?? english
  return {
    en: english,
    ca: translated('ca'),
    es: translated('es'),
    fr: translated('fr'),
    it: translated('it'),
    de: translated('de'),
    pt: translated('pt'),
  }
}

// Chromium locale files packaging keeps for each Teler language (context menus,
// spellcheck, native dialogs). electron-builder deletes the rest and matches
// names exactly: `.pak` files use hyphens, macOS `.lproj` folders underscores.
const CHROMIUM_LOCALES: Record<SupportedLanguage, readonly string[]> = {
  en: ['en-US', 'en-GB', 'en_GB'],
  ca: ['ca'],
  es: ['es', 'es-419', 'es_419'],
  fr: ['fr'],
  it: ['it'],
  de: ['de'],
  pt: ['pt-BR', 'pt_BR', 'pt-PT', 'pt_PT'],
}

/** electron-builder's `electronLanguages`, written by scripts/build.ts. */
export function electronLanguages(): string[] {
  return SUPPORTED_LANGUAGES.flatMap((language) => CHROMIUM_LOCALES[language])
}

// Electron's macOS locale folders for each Teler language. English uses the
// base Info.plist, so it needs no folder of its own.
const MAC_LOCALE_FOLDERS: Record<SupportedLanguage, readonly string[]> = {
  en: [],
  ca: ['ca'],
  es: ['es', 'es_419'],
  fr: ['fr'],
  it: ['it'],
  de: ['de'],
  pt: ['pt_BR', 'pt_PT'],
}

function stringsValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** `<locale>.lproj/InfoPlist.strings` files localizing the microphone prompt. */
export function macInfoPlistStrings(): Array<{ folder: string; contents: string }> {
  const microphone = localizedSystemString('system.microphoneUsage')
  return SUPPORTED_LANGUAGES.flatMap((language) =>
    MAC_LOCALE_FOLDERS[language].map((folder) => ({
      folder: `${folder}.lproj`,
      contents: `"NSMicrophoneUsageDescription" = "${stringsValue(microphone[language])}";\n`,
    }))
  )
}
