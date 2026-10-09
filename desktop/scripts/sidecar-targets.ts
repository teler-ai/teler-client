import { join } from 'node:path'

/** Sidecar targets by electron-builder `${os}-${arch}` name, with Bun's compile target. */
export const SIDECAR_TARGETS = {
  'mac-arm64': 'bun-darwin-arm64',
  'mac-x64': 'bun-darwin-x64',
  'linux-x64': 'bun-linux-x64',
  'linux-arm64': 'bun-linux-arm64',
  'win-x64': 'bun-windows-x64',
} as const
export type SidecarTarget = keyof typeof SIDECAR_TARGETS

export const appDir = join(import.meta.dir, '..')

export function isSidecarTarget(value: string): value is SidecarTarget {
  return value in SIDECAR_TARGETS
}

/** The target this machine runs. */
export function hostSidecarTarget(): SidecarTarget {
  const os = { darwin: 'mac', linux: 'linux', win32: 'win' }[process.platform as string]
  const target = `${os}-${process.arch}`
  if (!isSidecarTarget(target)) throw new Error(`Unsupported sidecar host: ${target}`)
  return target
}

/** Where scripts/sidecar.ts writes the compiled CLI for a target. */
export function sidecarBinary(target: SidecarTarget): string {
  return join(appDir, '.sidecar', target, target.startsWith('win') ? 'teler.exe' : 'teler')
}
