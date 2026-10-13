/**
 * Signature checks for a packaged Teler.app, used by scripts/verify-package.ts.
 * Every macOS build must carry intact signatures on the app and the sync sidecar:
 * macOS kills an executable whose signature is damaged. A notarized release must
 * also be signed with a Developer ID, the hardened runtime and a secure timestamp,
 * carry its stapled notarization ticket and pass Gatekeeper.
 */
import { join } from 'node:path'

interface CommandResult {
  ok: boolean
  output: string
}

function run(command: string[]): CommandResult {
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim()
  return { ok: result.exitCode === 0, output }
}

/** What the checks read from `codesign --display --verbose=2`. */
interface SigningDetails {
  authority: string | null
  teamIdentifier: string | null
  runtime: boolean
  timestamped: boolean
}

function signingDetails(path: string): SigningDetails {
  const { output } = run(['codesign', '--display', '--verbose=2', path])
  // The first Authority line is the signing certificate itself.
  const field = (name: string) => output.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1] ?? null
  return {
    authority: field('Authority'),
    teamIdentifier: field('TeamIdentifier'),
    runtime: /^CodeDirectory .*flags=0x[0-9a-f]+\([^)]*\bruntime\b/m.test(output),
    timestamped: field('Timestamp') !== null,
  }
}

export function macSignatureProblems(app: string, notarized: boolean): string[] {
  const problems: string[] = []
  const sidecar = join(app, 'Contents', 'Resources', 'sidecar', 'teler')
  const bundle = run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', app])
  if (!bundle.ok) problems.push(`invalid app signature: ${bundle.output}`)
  // --deep follows nested bundles and frameworks; the sidecar is a resource, so
  // its own signature is checked directly.
  const helper = run(['codesign', '--verify', '--strict', '--verbose=2', sidecar])
  if (!helper.ok) problems.push(`invalid sidecar signature: ${helper.output}`)
  if (!notarized) return problems

  const appDetails = signingDetails(app)
  const sidecarDetails = signingDetails(sidecar)
  if (!appDetails.authority?.startsWith('Developer ID Application:'))
    problems.push(`not signed with a Developer ID (${appDetails.authority ?? 'no authority'})`)
  if (sidecarDetails.teamIdentifier !== appDetails.teamIdentifier)
    problems.push('the sidecar is signed by another team')
  for (const [label, details] of [
    ['app', appDetails],
    ['sidecar', sidecarDetails],
  ] as const) {
    if (!details.runtime) problems.push(`the ${label} lacks the hardened runtime`)
    if (!details.timestamped) problems.push(`the ${label} lacks a secure timestamp`)
  }
  const ticket = run(['xcrun', 'stapler', 'validate', app])
  if (!ticket.ok) problems.push(`no stapled notarization ticket: ${ticket.output}`)
  const gatekeeper = run(['spctl', '--assess', '--type', 'execute', '--verbose=2', app])
  if (!gatekeeper.ok) problems.push(`Gatekeeper rejects the app: ${gatekeeper.output}`)
  return problems
}
