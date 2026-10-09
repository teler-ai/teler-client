#!/usr/bin/env bun
/**
 * Compiles the `teler` CLI into a standalone executable for each requested
 * target. electron-builder copies `.sidecar/${os}-${arch}` into the app's
 * resources, so the folder names use electron-builder's os names.
 *
 *   bun scripts/sidecar.ts                     # this machine
 *   bun scripts/sidecar.ts mac-arm64 mac-x64   # explicit targets
 */
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { developmentCliEntry } from '../src/main/sidecar'
import {
  SIDECAR_TARGETS,
  appDir,
  hostSidecarTarget,
  isSidecarTarget,
  sidecarBinary,
  type SidecarTarget,
} from './sidecar-targets'

const cliEntry = developmentCliEntry(appDir)

function parseTargets(values: string[]): SidecarTarget[] {
  if (values.length === 0) return [hostSidecarTarget()]
  return values.map((value) => {
    if (!isSidecarTarget(value)) throw new Error(`Unknown sidecar target: ${value}`)
    return value
  })
}

for (const target of parseTargets(process.argv.slice(2))) {
  const outfile = sidecarBinary(target)
  const directory = dirname(outfile)
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  const result = Bun.spawnSync(
    [
      process.execPath,
      'build',
      '--compile',
      '--minify',
      `--target=${SIDECAR_TARGETS[target]}`,
      cliEntry,
      '--outfile',
      outfile,
    ],
    { stdout: 'inherit', stderr: 'inherit' }
  )
  if (result.exitCode !== 0) throw new Error(`Compiling the ${target} sidecar failed`)
  console.info(`Compiled ${outfile}`)
}
