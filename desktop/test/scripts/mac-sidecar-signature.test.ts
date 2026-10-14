import { describe, expect, it } from 'vitest'
import { macSidecarSignatureCommands } from '../../scripts/mac-sidecar-signature'

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
