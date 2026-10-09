#!/usr/bin/env bun
/**
 * Checks every packaged app under `release/`: the archive may contain only
 * the bundled `dist/` and `package.json` (never a workspace's node_modules),
 * and the compiled `teler` sidecar and the app icon must sit next to it.
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { listPackage } from '@electron/asar'

const release = join(import.meta.dir, '..', 'release')

async function findArchives(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const found: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isFile() && entry.name === 'app.asar') found.push(path)
    else if (entry.isDirectory() && !entry.name.endsWith('.asar.unpacked'))
      found.push(...(await findArchives(path)))
  }
  return found
}

function problemsFor(archive: string): string[] {
  const problems: string[] = []
  // @electron/asar joins entries with the platform separator (`\` on Windows).
  const entries = listPackage(archive, { isPack: false }).map((entry) =>
    entry.replaceAll('\\', '/')
  )
  const unexpected = entries.filter(
    (entry) => entry !== '/package.json' && entry !== '/dist' && !entry.startsWith('/dist/')
  )
  if (unexpected.length)
    problems.push(`unexpected files: ${unexpected.slice(0, 10).join(', ')} (${unexpected.length})`)
  if (existsSync(`${archive}.unpacked`)) problems.push('unexpected app.asar.unpacked directory')
  const sidecar = join(dirname(archive), 'sidecar')
  if (!existsSync(join(sidecar, 'teler')) && !existsSync(join(sidecar, 'teler.exe')))
    problems.push('missing the teler sidecar')
  if (!existsSync(join(dirname(archive), 'icon.png'))) problems.push('missing the app icon')
  return problems
}

const archives = existsSync(release) ? await findArchives(release) : []
if (archives.length === 0) throw new Error(`No packaged apps found under ${release}`)
let failed = false
for (const archive of archives) {
  const problems = problemsFor(archive)
  const label = `${basename(dirname(dirname(archive)))}/${basename(dirname(archive))}`
  if (problems.length) {
    failed = true
    console.error(`✗ ${label}: ${problems.join('; ')}`)
  } else console.info(`✓ ${label}: only the bundled app, the teler sidecar and the icon`)
}
if (failed) process.exit(1)
