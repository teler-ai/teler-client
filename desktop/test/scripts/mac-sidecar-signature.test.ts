import { describe, expect, it } from 'vitest'
import { macSidecarSignatureCommands, resignsMacSidecar } from '../../scripts/mac-sidecar-signature'

describe('macOS sidecar signature', () => {
  const commands = macSidecarSignatureCommands('/repo/desktop/.sidecar/mac-arm64/teler')

  it('drops the signature slot Bun leaves, which codesign cannot read', () => {
    expect(commands[0]).toEqual([
      'codesign',
      '--remove-signature',
      '/repo/desktop/.sidecar/mac-arm64/teler',
    ])
  })

  it('then signs ad hoc with codesign, so electron-builder can sign it with the release identity', () => {
    expect(commands[1]).toEqual([
      'codesign',
      '--force',
      '--sign',
      '-',
      '/repo/desktop/.sidecar/mac-arm64/teler',
    ])
    expect(commands).toHaveLength(2)
  })
})

describe('which sidecars are re-signed', () => {
  it('re-signs the macOS sidecars on a Mac', () => {
    expect(resignsMacSidecar('mac-arm64', 'darwin')).toBe(true)
    expect(resignsMacSidecar('mac-x64', 'darwin')).toBe(true)
  })

  it('leaves other targets alone, and every target on a host without codesign', () => {
    expect(resignsMacSidecar('linux-x64', 'darwin')).toBe(false)
    expect(resignsMacSidecar('win-x64', 'darwin')).toBe(false)
    expect(resignsMacSidecar('mac-arm64', 'linux')).toBe(false)
    expect(resignsMacSidecar('mac-x64', 'win32')).toBe(false)
  })
})
