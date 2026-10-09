import { describe, expect, it } from 'vitest'
import { LOCALES } from '../../src/renderer/i18n'
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages'

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') entries.set(path, value)
    else for (const [nested, text] of flatten(value, path)) entries.set(nested, text)
  }
  return entries
}

const english = flatten(LOCALES.en)

describe('desktop locales', () => {
  it('ships every supported language', () => {
    expect(Object.keys(LOCALES).sort()).toEqual([...SUPPORTED_LANGUAGES].sort())
  })

  it.each(SUPPORTED_LANGUAGES)(
    '%s has exactly the English keys and no empty strings',
    (language) => {
      const strings = flatten(LOCALES[language])
      expect([...strings.keys()].sort()).toEqual([...english.keys()].sort())
      for (const [key, text] of strings) expect(text.trim(), `${language}:${key}`).not.toBe('')
    }
  )

  it.each(SUPPORTED_LANGUAGES)('%s keeps every interpolation placeholder', (language) => {
    const placeholders = (text: string) => (text.match(/{{[^}]+}}/g) ?? []).sort()
    for (const [key, text] of flatten(LOCALES[language])) {
      expect(placeholders(text), `${language}:${key}`).toEqual(placeholders(english.get(key) ?? ''))
    }
  })
})
