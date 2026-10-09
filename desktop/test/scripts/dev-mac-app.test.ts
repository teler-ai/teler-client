import { describe, expect, it } from 'vitest'
import { devMacAppCommands } from '../../scripts/dev-mac-app'

describe('development macOS app', () => {
  const commands = devMacAppCommands({
    electronApp: '/repo/node_modules/electron/dist/Electron.app',
    app: '/cache/Teler.app',
    icon: '/repo/desktop/build/icon.png',
    iconset: '/cache/teler.iconset',
  })
  const plist = '/cache/Teler.app/Contents/Info.plist'

  it('copies Electron and names the copy Teler', () => {
    expect(commands[0]).toEqual([
      'ditto',
      '/repo/node_modules/electron/dist/Electron.app',
      '/cache/Teler.app',
    ])
    expect(commands).toContainEqual([
      'plutil',
      '-replace',
      'CFBundleName',
      '-string',
      'Teler',
      plist,
    ])
    expect(commands).toContainEqual([
      'plutil',
      '-replace',
      'CFBundleDisplayName',
      '-string',
      'Teler',
      plist,
    ])
    expect(commands).toContainEqual([
      'plutil',
      '-replace',
      'CFBundleIdentifier',
      '-string',
      'ai.teler.desktop.dev',
      plist,
    ])
  })

  it('keeps the Electron executable, so helpers resolve and the app stays a development run', () => {
    expect(commands.flat().join(' ')).not.toContain('CFBundleExecutable')
  })

  it('replaces the Electron icon with every iconset size', () => {
    const resized = commands.filter(([command]) => command === 'sips')
    expect(resized.map((command) => command.at(-1))).toEqual([
      '/cache/teler.iconset/icon_16x16.png',
      '/cache/teler.iconset/icon_16x16@2x.png',
      '/cache/teler.iconset/icon_32x32.png',
      '/cache/teler.iconset/icon_32x32@2x.png',
      '/cache/teler.iconset/icon_128x128.png',
      '/cache/teler.iconset/icon_128x128@2x.png',
      '/cache/teler.iconset/icon_256x256.png',
      '/cache/teler.iconset/icon_256x256@2x.png',
      '/cache/teler.iconset/icon_512x512.png',
      '/cache/teler.iconset/icon_512x512@2x.png',
    ])
    expect(resized[1]).toEqual([
      'sips',
      '-z',
      '32',
      '32',
      '/repo/desktop/build/icon.png',
      '--out',
      '/cache/teler.iconset/icon_16x16@2x.png',
    ])
    expect(commands).toContainEqual([
      'iconutil',
      '-c',
      'icns',
      '/cache/teler.iconset',
      '-o',
      '/cache/Teler.app/Contents/Resources/electron.icns',
    ])
  })

  it('re-signs the edited bundle ad hoc last', () => {
    expect(commands.at(-1)).toEqual([
      'codesign',
      '--force',
      '--deep',
      '--sign',
      '-',
      '/cache/Teler.app',
    ])
  })
})
