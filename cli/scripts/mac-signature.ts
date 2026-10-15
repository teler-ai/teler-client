/**
 * `bun build --compile` leaves a signature slot at the end of a macOS
 * executable that `codesign` cannot read or replace, and recent macOS may
 * refuse to start such a file. Dropping that slot and signing again gives a
 * valid signature: ad hoc on a developer's Mac, or with Teler's Developer ID
 * and the hardened runtime in a release, which Apple then notarizes.
 */
export function macSignatureCommands(
  binary: string,
  identity: string | undefined,
  entitlements: string
): string[][] {
  const sign = identity
    ? [
        'codesign',
        '--force',
        '--options',
        'runtime',
        '--timestamp',
        '--entitlements',
        entitlements,
        '--sign',
        identity,
        binary,
      ]
    : ['codesign', '--force', '--sign', '-', binary]
  return [['codesign', '--remove-signature', binary], sign]
}

/** codesign only exists on a Mac; the macOS release job runs on a macOS runner. */
export function signsMacBinary(target: string, platform: NodeJS.Platform): boolean {
  return target.startsWith('mac-') && platform === 'darwin'
}
