import { describe, expect, it } from 'vitest'
import { PREFERENCE_COOKIE_NAMES } from '../../src/shared/preference-cookies'

describe('preference cookies', () => {
  it('are the names the Teler web app sets on its origin', () => {
    expect(PREFERENCE_COOKIE_NAMES).toEqual({
      language: 'i18next',
      themeVariant: 'theme-variant',
      colorMode: 'theme',
    })
  })
})
