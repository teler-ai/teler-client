#!/usr/bin/env bun
/**
 * Compiles standalone `teler` executables, with the Bun runtime inside, into
 * `release/`. Targets are release names; the default is this machine's.
 *
 *   bun scripts/compile.ts                       # this machine
 *   bun scripts/compile.ts linux-x64 win-x64     # explicit targets
 *
 * On a Mac, macOS executables are re-signed (scripts/mac-signature.ts): with
 * the identity in TELER_MAC_SIGN_IDENTITY when it is set, ad hoc otherwise.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { releaseBinaryName, releaseTarget } from '../src/runtime'
import { macSignatureCommands, signsMacBinary } from './mac-signature'

const BUN_TARGETS: Record<string, string> = {
  'mac-arm64': 'bun-darwin-arm64',
  'mac-x64': 'bun-darwin-x64',
  'linux-x64': 'bun-linux-x64',
  'linux-arm64': 'bun-linux-arm64',
  'win-x64': 'bun-windows-x64',
}
const root = join(import.meta.dir, '..')
const entitlements = join(root, 'build', 'entitlements.mac.plist')
const identity = process.env.TELER_MAC_SIGN_IDENTITY || undefined
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
  if (signsMacBinary(target, process.platform)) {
    for (const command of macSignatureCommands(outfile, identity, entitlements)) {
      const signed = Bun.spawnSync(command, { stdout: 'inherit', stderr: 'inherit' })
      if (signed.exitCode !== 0) throw new Error(`Signing ${target} failed`)
    }
  }
  console.info(`Compiled ${outfile}`)
}
