/**
 * macOS development runs use the stock Electron.app, so the menu bar, Dock,
 * notifications and keychain prompts say "Electron". This keeps a cached copy
 * named Teler with Teler's icon, re-signed ad hoc, per Electron version and icon.
 *
 * The executable keeps its name: Electron finds its helper apps by it, and
 * `app.isPackaged` stays false so the app still behaves as a development run.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const ICONSET_SIZES = [16, 32, 128, 256, 512]

export interface DevMacAppPaths {
  electronApp: string
  app: string
  icon: string
  iconset: string
}

/** The commands that turn a copy of Electron.app into a Teler-named one. */
export function devMacAppCommands(paths: DevMacAppPaths): string[][] {
  const plist = join(paths.app, 'Contents', 'Info.plist')
  const setString = (key: string, value: string) => [
    'plutil',
    '-replace',
    key,
    '-string',
    value,
    plist,
  ]
  const icons = ICONSET_SIZES.flatMap((size) =>
    [1, 2].map((scale) => {
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`
      const pixels = String(size * scale)
      return ['sips', '-z', pixels, pixels, paths.icon, '--out', join(paths.iconset, name)]
    })
  )
  return [
    ['ditto', paths.electronApp, paths.app],
    setString('CFBundleName', 'Teler'),
    setString('CFBundleDisplayName', 'Teler'),
    setString('CFBundleIdentifier', 'ai.teler.desktop.dev'),
    ...icons,
    [
      'iconutil',
      '-c',
      'icns',
      paths.iconset,
      '-o',
      join(paths.app, 'Contents', 'Resources', 'electron.icns'),
    ],
    ['codesign', '--force', '--deep', '--sign', '-', paths.app],
  ]
}

/**
 * The Teler-named Electron executable for this checkout, built on first use.
 * Returns null (use Electron as is) when anything fails.
 */
export async function prepareDevMacApp(appDir: string): Promise<string | null> {
  try {
    const manifest = createRequire(join(appDir, 'package.json')).resolve('electron/package.json')
    const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }
    const icon = join(appDir, 'build', 'icon.png')
    const iconHash = createHash('sha256').update(readFileSync(icon)).digest('hex').slice(0, 12)
    const cache = join(appDir, '.dev-app')
    const key = `${version}-${iconHash}`
    const app = join(cache, key, 'Teler.app')
    const executable = join(app, 'Contents', 'MacOS', 'Electron')
    if (existsSync(executable)) return executable

    console.info('Preparing a Teler-named Electron for development (once per Electron version)…')
    await rm(cache, { recursive: true, force: true })
    const staging = join(cache, `${key}.partial`)
    await mkdir(join(staging, 'teler.iconset'), { recursive: true })
    const commands = devMacAppCommands({
      electronApp: join(dirname(manifest), 'dist', 'Electron.app'),
      app: join(staging, 'Teler.app'),
      icon,
      iconset: join(staging, 'teler.iconset'),
    })
    for (const [command, ...args] of commands)
      execFileSync(command!, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    await rm(join(staging, 'teler.iconset'), { recursive: true })
    await rename(staging, join(cache, key))
    return executable
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
    console.warn(`Using the stock Electron app: could not prepare the Teler-named copy (${reason})`)
    return null
  }
}
