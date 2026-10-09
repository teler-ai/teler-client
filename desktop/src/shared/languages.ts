// The languages Teler is available in. Desktop catalogs are typed by this list,
// so adding a language fails typecheck until the desktop copy is translated.
export const SUPPORTED_LANGUAGES = ['en', 'ca', 'es', 'fr', 'it', 'de', 'pt'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export function getSupportedLanguage(language?: string | null): SupportedLanguage {
  const base = language?.toLowerCase().split(/[-_]/)[0]
  return SUPPORTED_LANGUAGES.find((supported) => supported === base) ?? 'en'
}
