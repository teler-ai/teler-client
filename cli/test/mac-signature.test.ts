import { describe, expect, it } from 'bun:test'
import { macSignatureCommands, signsMacBinary } from '../scripts/mac-signature'

const binary = '/repo/cli/release/teler-mac-arm64'
const entitlements = '/repo/cli/build/entitlements.mac.plist'

describe('macOS executable signature', () => {
  it('first drops the signature slot Bun leaves, which codesign cannot replace', () => {
    expect(macSignatureCommands(binary, undefined, entitlements)[0]).toEqual([
      'codesign',
      '--remove-signature',
      binary,
    ])
  })

  it('signs ad hoc without an identity, as on a developer Mac', () => {
    const commands = macSignatureCommands(binary, undefined, entitlements)
    expect(commands[1]).toEqual(['codesign', '--force', '--sign', '-', binary])
    expect(commands).toHaveLength(2)
  })

  it('signs a release with the identity, the hardened runtime, a timestamp and the entitlements', () => {
    const identity = 'Developer ID Application: Example (TEAMID1234)'
    const commands = macSignatureCommands(binary, identity, entitlements)
    expect(commands[1]).toEqual([
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
    ])
    expect(commands).toHaveLength(2)
  })
})

describe('which executables are signed', () => {
  it('signs the macOS executables on a Mac', () => {
    expect(signsMacBinary('mac-arm64', 'darwin')).toBe(true)
    expect(signsMacBinary('mac-x64', 'darwin')).toBe(true)
  })

  it('leaves other targets alone, and every target on a host without codesign', () => {
    expect(signsMacBinary('linux-x64', 'darwin')).toBe(false)
    expect(signsMacBinary('win-x64', 'darwin')).toBe(false)
    expect(signsMacBinary('mac-arm64', 'linux')).toBe(false)
  })
})
