import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { ACCESS_COOKIE, AccessToken, withAccessHeader } from '../../src/main/access-token'

const origin = 'https://app.teler.example'
type CookieListener = (event: unknown, cookie: { name: string }) => void

function jar(initial: string | null) {
  let value = initial
  const events = new EventEmitter()
  const change = (name: string) => events.emit('changed', {}, { name })
  return {
    renew(next: string | null) {
      value = next
      change(ACCESS_COOKIE)
    },
    change,
    cookies: {
      async get(filter: { url: string; name: string }) {
        return filter.url === origin && filter.name === ACCESS_COOKIE && value ? [{ value }] : []
      },
      on(event: 'changed', listener: CookieListener) {
        return events.on(event, listener)
      },
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Cloudflare Access token', () => {
  it('reads the token and reports only real renewals', async () => {
    const session = jar('access-1')
    const access = new AccessToken(origin, session.cookies)
    let changes = 0
    await access.watch(() => changes++)
    expect(access.current).toBe('access-1')

    session.change('teler.session_token')
    session.change(ACCESS_COOKIE)
    await settle()
    expect(changes).toBe(0)

    session.renew('access-2')
    await settle()
    expect(access.current).toBe('access-2')
    expect(changes).toBe(1)

    session.renew(null)
    await settle()
    expect(access.current).toBeNull()
    expect(changes).toBe(2)
  })

  it('has no token on an origin without Access', async () => {
    const access = new AccessToken(origin, jar(null).cookies)
    await access.watch(() => undefined)
    expect(access.current).toBeNull()
  })

  it('adds the token only to requests for the Teler origin', () => {
    const headers = (init: RequestInit | undefined) =>
      new Headers(init?.headers).get('cf-access-token')
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    const sent = withAccessHeader(init, `${origin}/api/auth/device/code`, origin, 'access-1')
    expect(headers(sent)).toBe('access-1')
    expect(new Headers(sent?.headers).get('content-type')).toBe('application/json')
    expect(sent?.method).toBe('POST')
    expect(withAccessHeader(init, 'https://app.teler.ai/api/x', origin, 'access-1')).toBe(init)
    expect(withAccessHeader(init, `${origin}/api/x`, origin, null)).toBe(init)
  })
})
