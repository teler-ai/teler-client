import { isNewer, latestRelease, type Release, type ReleaseFetch } from '@teler-ai/cli/releases'

export interface AvailableUpdate {
  version: string
  /** This platform's installer, or the release page when there is none. */
  downloadUrl: string
}

export interface Installation {
  platform: NodeJS.Platform
  arch: string
  /** Running from an AppImage (`APPIMAGE` is set), not an installed package. */
  appImage: boolean
}

/** electron-builder's names for an architecture in Linux package file names. */
const LINUX_ARCH: Record<string, string[]> = {
  x64: ['x64', 'x86_64', 'amd64'],
  arm64: ['arm64', 'aarch64'],
}

/** The installer for this machine among `Teler-<version>-<os>-<arch>.<ext>` assets. */
export function installerUrl(release: Release, installation: Installation): string | null {
  const { platform, arch } = installation
  const names = platform === 'linux' ? (LINUX_ARCH[arch] ?? [arch]) : [arch]
  const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[platform as string]
  const extension =
    platform === 'darwin'
      ? '.dmg'
      : platform === 'win32'
        ? '.exe'
        : installation.appImage
          ? '.AppImage'
          : '.deb'
  const asset = release.assets.find(
    (item) =>
      item.name.startsWith('Teler-') &&
      item.name.endsWith(extension) &&
      names.some((name) => item.name.includes(`-${os}-${name}`))
  )
  return asset?.url ?? null
}

/** A newer stable Teler Desktop release than `current`, or null. Throws when unreachable. */
export async function findUpdate(
  current: string,
  installation: Installation,
  fetchImpl?: ReleaseFetch
): Promise<AvailableUpdate | null> {
  const release = await latestRelease('desktop', {
    fetch: fetchImpl,
    signal: AbortSignal.timeout(15_000),
    userAgent: `TelerDesktop/${current}`,
  })
  if (!release || !isNewer(release.version, current)) return null
  return {
    version: release.version,
    downloadUrl: installerUrl(release, installation) ?? release.pageUrl,
  }
}
