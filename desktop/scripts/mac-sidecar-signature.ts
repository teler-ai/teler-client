/**
 * `bun build --compile` leaves a signature slot at the end of the executable
 * that `codesign` cannot read, so electron-builder could not sign the sidecar
 * and Apple rejects it when the app is notarized ("The signature of the binary
 * is invalid"). Dropping that slot and signing ad hoc with `codesign` gives
 * electron-builder a binary it can re-sign with the release identity, and one
 * Apple silicon still runs for the smoke test before packaging.
 */
export function macSidecarSignatureCommands(binary: string): string[][] {
  return [
    ['codesign', '--remove-signature', binary],
    ['codesign', '--force', '--sign', '-', binary],
  ]
}
