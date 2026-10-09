import { describe, expect, it } from 'vitest'
import { buildDestination, isValidDestination } from '../../src/shared/destination'

describe('destinations', () => {
  it('accepts every folder name the server accepts', () => {
    expect(buildDestination('personal', ' Q3: Budget? ')).toBe('/personal/Q3: Budget?')
    expect(buildDestination('organization', 'Sales "2026" <final>')).toBe(
      '/organization/Sales "2026" <final>'
    )
    expect(isValidDestination('/personal/Q3: Budget')).toBe(true)
    expect(isValidDestination('/organization/a/b')).toBe(true)
  })

  it('rejects names the server or the sync scope would refuse', () => {
    for (const name of ['', '  ', '.', '..', 'a/b', 'back\\slash', 'tab\tname', 'nul\u0000'])
      expect(buildDestination('personal', name), JSON.stringify(name)).toBeNull()
    for (const destination of [
      '/shared/x',
      '/personal/../organization',
      '/personal//x',
      '/personal/x/',
      '/personal/a\\b',
      'personal/x',
    ])
      expect(isValidDestination(destination), destination).toBe(false)
  })
})
