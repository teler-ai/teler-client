import { describe, expect, it } from 'vitest'
import { SUPPORTED_LANGUAGES } from '../../src/shared/languages'
import {
  electronLanguages,
  localizedSystemString,
  macInfoPlistStrings,
} from '../../src/main/system-strings'

describe('system strings', () => {
  it('translate OS-facing copy into every supported language', () => {
    const descriptions = localizedSystemString('system.appDescription')
    expect(Object.keys(descriptions).sort()).toEqual([...SUPPORTED_LANGUAGES].sort())
    expect(descriptions.en).toBe('Teler with background folder sync')
    expect(descriptions.ca).toBe('Teler amb sincronització de carpetes en segon pla')
  })

  it('keeps Chromium locales for every language in both platform spellings', () => {
    const kept = electronLanguages()
    for (const language of SUPPORTED_LANGUAGES)
      expect(
        kept.some((name) => name === language || name.startsWith(`${language}-`)),
        language
      ).toBe(true)
    // macOS names regional folders with underscores; hyphens never match them.
    expect(kept).toEqual(expect.arrayContaining(['pt_BR', 'pt_PT', 'pt-BR', 'pt-PT', 'es_419']))
  })

  it('writes a localized microphone prompt into each macOS locale folder', () => {
    const files = Object.fromEntries(
      macInfoPlistStrings().map(({ folder, contents }) => [folder, contents])
    )
    expect(Object.keys(files).sort()).toEqual([
      'ca.lproj',
      'de.lproj',
      'es.lproj',
      'es_419.lproj',
      'fr.lproj',
      'it.lproj',
      'pt_BR.lproj',
      'pt_PT.lproj',
    ])
    expect(files['de.lproj']).toBe(
      '"NSMicrophoneUsageDescription" = "Teler verwendet das Mikrofon, wenn Sie eine Nachricht diktieren.";\n'
    )
    for (const contents of Object.values(files))
      expect(contents).toMatch(/^"NSMicrophoneUsageDescription" = "[^"\\]*(\\.[^"\\]*)*";\n$/)
  })
})
