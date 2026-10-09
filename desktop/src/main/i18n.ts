import type { SupportedLanguage } from '../shared/languages'
import ca from './locales/ca.json'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import it from './locales/it.json'
import pt from './locales/pt.json'

export type MessageKey = keyof typeof en
export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string

/** Main-process copy: tray, menus, dialogs and notifications. */
export const MAIN_CATALOGS: Record<SupportedLanguage, Record<string, string>> = {
  en,
  ca,
  es,
  fr,
  it,
  de,
  pt,
}

export function createTranslator(language: SupportedLanguage): Translate {
  const catalog = MAIN_CATALOGS[language]
  return (key, values = {}) =>
    (catalog[key] ?? en[key]).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
      String(values[name] ?? '')
    )
}
