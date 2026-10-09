import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../shared/languages'
import ca from './locales/ca.json'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import it from './locales/it.json'
import pt from './locales/pt.json'

export const DESKTOP_NAMESPACE = 'desktop'

/** Every locale ships in the bundle: the local pages never fetch. */
export const LOCALES: Record<SupportedLanguage, typeof en> = { en, ca, es, fr, it, de, pt }

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(
    SUPPORTED_LANGUAGES.map((language) => [language, { [DESKTOP_NAMESPACE]: LOCALES[language] }])
  ),
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGUAGES,
  ns: [DESKTOP_NAMESPACE],
  defaultNS: DESKTOP_NAMESPACE,
  initAsync: false,
  interpolation: {
    // React escapes rendered strings.
    escapeValue: false,
  },
})

export default i18n
