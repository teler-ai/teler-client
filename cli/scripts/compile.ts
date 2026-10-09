#!/usr/bin/env bun
/**
 * Compiles standalone `teler` executables, with the Bun runtime inside, into
 * `release/`. Targets are release names; the default is this machine's.
 *
 *   bun scripts/compile.ts                       # this machine
 *   bun scripts/compile.ts linux-x64 win-x64     # explicit targets
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { releaseBinaryName, releaseTarget } from '../src/runtime'

const BUN_TARGETS: Record<string, string> = {
  'mac-arm64': 'bun-darwin-arm64',
  'mac-x64': 'bun-darwin-x64',
  'linux-x64': 'bun-linux-x64',
  'linux-arm64': 'bun-linux-arm64',
  'win-x64': 'bun-windows-x64',
}
const root = join(import.meta.dir, '..')
const host = releaseTarget(process.platform, process.arch)
const targets = process.argv.length > 2 ? process.argv.slice(2) : host ? [host] : []
if (targets.length === 0) throw new Error(`No teler release target for ${process.platform}`)

await mkdir(join(root, 'release'), { recursive: true })
for (const target of targets) {
  const bunTarget = BUN_TARGETS[target]
  if (!bunTarget) throw new Error(`Unknown target: ${target}`)
  const outfile = join(root, 'release', releaseBinaryName(target))
  const result = Bun.spawnSync(
    [
      process.execPath,
      'build',
      '--compile',
      '--minify',
      `--target=${bunTarget}`,
      join(root, 'src', 'index.ts'),
      '--outfile',
      outfile,
    ],
    { stdout: 'inherit', stderr: 'inherit' }
  )
  if (result.exitCode !== 0) throw new Error(`Compiling ${target} failed`)
  console.info(`Compiled ${outfile}`)
}
