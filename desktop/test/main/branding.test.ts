import { COLOR_MODES, THEME_VARIANTS } from '../../src/shared/appearance'
import { describe, expect, it } from 'vitest'
import {
  aboutPanelOptions,
  desktopUserAgent,
  THEME_SURFACES,
  themeSurface,
  windowIcon,
} from '../../src/main/branding'
import { buildContextMenu, type ContextMenuParams } from '../../src/main/context-menu'
import { createTranslator } from '../../src/main/i18n'

const t = createTranslator('en')

describe('user agent', () => {
  const chromium =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Teler/0.1.0 Chrome/146.0.7680.65 Electron/44.5.1 Safari/537.36'

  it('drops the Electron and app tokens and names Teler Desktop', () => {
    expect(desktopUserAgent(chromium, 'Teler', '0.1.0')).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.65 Safari/537.36 TelerDesktop/0.1.0'
    )
  })

  it('keeps a user agent that has no Electron tokens', () => {
    expect(desktopUserAgent('Mozilla/5.0 Chrome/146 Safari/537.36', 'Teler', '1.2.3')).toBe(
      'Mozilla/5.0 Chrome/146 Safari/537.36 TelerDesktop/1.2.3'
    )
  })
})

/** CSS Color 4 OKLCH to an sRGB hex colour. */
/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

describe('theme surfaces', () => {
  it('give every theme and mode readable native colours', () => {
    for (const variant of THEME_VARIANTS)
      for (const mode of COLOR_MODES) {
        const { background, foreground } = THEME_SURFACES[variant][mode]
        expect(background, `${variant} ${mode}`).toMatch(/^#[0-9a-f]{6}$/)
        expect(foreground, `${variant} ${mode}`).toMatch(/^#[0-9a-f]{6}$/)
        expect(contrast(background, foreground), `${variant} ${mode}`).toBeGreaterThanOrEqual(7)
      }
  })

  it('pick the surface for the current preferences', () => {
    expect(themeSurface({ themeVariant: 'default', colorMode: 'light' }).background).toBe('#faf8f5')
    expect(themeSurface({ themeVariant: 'editorial', colorMode: 'dark' })).toEqual(
      THEME_SURFACES.editorial.dark
    )
  })
})

describe('about panel', () => {
  it('names Teler with its version, website and localized description', () => {
    expect(aboutPanelOptions('0.1.0', '/icons/teler.png', createTranslator('ca'))).toEqual({
      applicationName: 'Teler',
      applicationVersion: '0.1.0',
      version: '0.1.0',
      copyright: 'Copyright © teler.ai',
      website: 'https://teler.ai',
      credits: createTranslator('ca')('system.appDescription'),
      iconPath: '/icons/teler.png',
    })
  })
})

describe('window icon', () => {
  it('sets the Teler icon where the platform would show Electron’s', () => {
    expect(windowIcon('linux', true, '/i.png')).toBe('/i.png')
    expect(windowIcon('win32', false, '/i.png')).toBe('/i.png')
    // Installed Windows builds use the executable’s icon; macOS uses the bundle.
    expect(windowIcon('win32', true, '/i.png')).toBeUndefined()
    expect(windowIcon('darwin', false, '/i.png')).toBeUndefined()
  })
})

function params(overrides: Partial<ContextMenuParams> = {}): ContextMenuParams {
  return {
    isEditable: false,
    selectionText: '',
    linkURL: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canSelectAll: false,
    },
    ...overrides,
  }
}

const kinds = (items: ReturnType<typeof buildContextMenu>) =>
  items.map((item) => (item.type === 'role' ? item.role : item.type))

describe('context menu', () => {
  it('offers nothing on plain page content', () => {
    expect(buildContextMenu(params(), t)).toEqual([])
  })

  it('copies selected text', () => {
    const items = buildContextMenu(
      params({ selectionText: 'revenue', editFlags: { ...params().editFlags, canCopy: true } }),
      t
    )
    expect(items).toEqual([{ type: 'role', role: 'copy', label: 'Copy', enabled: true }])
  })

  it('edits text fields and suggests spellings first', () => {
    const items = buildContextMenu(
      params({
        isEditable: true,
        misspelledWord: 'revnue',
        dictionarySuggestions: ['revenue', 'revue'],
        editFlags: {
          canUndo: true,
          canRedo: false,
          canCut: true,
          canCopy: true,
          canPaste: true,
          canSelectAll: true,
        },
      }),
      t
    )
    expect(items.slice(0, 2)).toEqual([
      { type: 'suggestion', word: 'revenue', label: 'revenue' },
      { type: 'suggestion', word: 'revue', label: 'revue' },
    ])
    expect(kinds(items)).toEqual([
      'suggestion',
      'suggestion',
      'add-to-dictionary',
      'separator',
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'separator',
      'selectAll',
    ])
    expect(items).toContainEqual({ type: 'role', role: 'redo', label: 'Redo', enabled: false })
  })

  it('copies web links but not other schemes', () => {
    expect(buildContextMenu(params({ linkURL: 'https://teler.ai/docs' }), t)).toEqual([
      { type: 'copy-link', url: 'https://teler.ai/docs', label: 'Copy Link' },
    ])
    expect(buildContextMenu(params({ linkURL: 'javascript:alert(1)' }), t)).toEqual([])
  })
})
