import { describe, expect, it } from 'bun:test'
import { DEFAULT_TELER_URL, resolveTelerUrl } from '../src/url'

describe('resolveTelerUrl', () => {
  it('defaults to the production application origin', () => {
    expect(DEFAULT_TELER_URL).toBe('https://app.teler.ai')
    expect(resolveTelerUrl({}).origin).toBe(DEFAULT_TELER_URL)
  })

  it('accepts and canonicalizes an HTTPS TELER_URL origin', () => {
    expect(resolveTelerUrl({ TELER_URL: 'https://app.teler.example/' }).origin).toBe(
      'https://app.teler.example'
    )
  })

  it('allows HTTP only for loopback development', () => {
    expect(resolveTelerUrl({ TELER_URL: 'http://localhost:8788' }).origin).toBe(
      'http://localhost:8788'
    )
    expect(() => resolveTelerUrl({ TELER_URL: 'http://app.example.test' })).toThrow(
      'TELER_URL must use HTTPS'
    )
  })

  it('rejects paths, credentials, queries, and fragments', () => {
    for (const value of [
      'https://app.teler.ai/api',
      'https://user:secret@app.teler.ai',
      'https://app.teler.ai?token=secret',
      'https://app.teler.ai#secret',
    ]) {
      expect(() => resolveTelerUrl({ TELER_URL: value })).toThrow('TELER_URL must be an origin')
    }
  })

  it('does not echo malformed values in errors', () => {
    const secret = 'not-a-url-with-secret-value'
    expect(() => resolveTelerUrl({ TELER_URL: secret })).toThrow('TELER_URL must be a valid URL')
    try {
      resolveTelerUrl({ TELER_URL: secret })
    } catch (error) {
      expect(String(error)).not.toContain(secret)
    }
  })
})
