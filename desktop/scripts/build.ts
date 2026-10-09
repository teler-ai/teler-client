#!/usr/bin/env bun
/**
 * Bundles Teler Desktop into `dist/`: the main process and preload as single
 * CommonJS files (the packaged app ships no node_modules), the settings
 * renderer with Vite, and the icon used by the tray. It also writes the
 * localized macOS `InfoPlist.strings` that packaging copies into the app.
 */
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build as viteBuild } from 'vite'
import { electronLanguages, macInfoPlistStrings } from '../src/main/system-strings'

const appDir = join(import.meta.dir, '..')
const dist = join(appDir, 'dist')
const macLocales = join(appDir, '.packaging', 'mac')

async function bundle(entry: string, outdir: string, target: 'node' | 'browser') {
  const result = await Bun.build({
    entrypoints: [join(appDir, entry)],
    outdir: join(dist, outdir),
    target,
    format: 'cjs',
    external: ['electron'],
    naming: { entry: '[name].cjs' },
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`Bundling ${entry} failed`)
  }
}

await rm(dist, { recursive: true, force: true })
await bundle('src/main/index.ts', 'main', 'node')
// Sandboxed preloads only get Electron's renderer modules, not Node.
await bundle('src/preload/settings.ts', 'preload', 'browser')
await bundle('src/preload/title-bar.ts', 'preload', 'browser')
await viteBuild({ configFile: join(appDir, 'vite.config.ts'), logLevel: 'warn' })
await mkdir(dist, { recursive: true })
await copyFile(join(appDir, 'build', 'icon.png'), join(dist, 'icon.png'))

await rm(macLocales, { recursive: true, force: true })
for (const { folder, contents } of macInfoPlistStrings()) {
  await mkdir(join(macLocales, folder), { recursive: true })
  await writeFile(join(macLocales, folder, 'InfoPlist.strings'), contents)
}
// Typed per language in system-strings.ts, read back by electron-builder.js.
await writeFile(
  join(appDir, '.packaging', 'electron-languages.json'),
  `${JSON.stringify(electronLanguages(), null, 2)}\n`
)
console.info(`Built Teler Desktop into ${dist}`)
