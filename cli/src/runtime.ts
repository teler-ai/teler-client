/**
 * A compiled `teler` executable embeds its sources in Bun's virtual filesystem
 * ($bunfs, or ~BUN on Windows) and is itself the CLI entry point.
 */
export function isCompiledModule(moduleUrl: string): boolean {
  return /\/(?:\$bunfs|~BUN)\/root\//.test(moduleUrl)
}

/** The release build name for a platform, as in `teler-mac-arm64`. */
export function releaseTarget(platform: NodeJS.Platform, arch: string): string | null {
  const os = { darwin: 'mac', linux: 'linux', win32: 'win' }[platform as string]
  const target = `${os}-${arch}`
  return ['mac-arm64', 'mac-x64', 'linux-x64', 'linux-arm64', 'win-x64'].includes(target)
    ? target
    : null
}

/** The released executable for a target: `teler-linux-x64`, `teler-win-x64.exe`. */
export function releaseBinaryName(target: string): string {
  return `teler-${target}${target.startsWith('win-') ? '.exe' : ''}`
}
