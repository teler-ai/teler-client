import { describe, expect, it } from 'vitest'
import {
  fetchSyncAccount,
  startDeviceAuthorization,
  type DeviceLoginDeps,
} from '../../src/main/device-login'

const origin = 'https://app.teler.ai'
type Reply = Response | Error

function deps(replies: Record<string, Reply[]>) {
  const requests: Array<{ url: string; init?: RequestInit; at: number }> = []
  let now = 0
  const fake: DeviceLoginDeps = {
    async fetch(url, init) {
      requests.push({ url, init, at: now })
      const path = new URL(url).pathname
      const next = replies[path]?.shift()
      if (!next) throw new Error(`unexpected request ${path}`)
      if (next instanceof Error) throw next
      return next
    },
    async wait(ms) {
      now += ms
    },
    now: () => now,
  }
  return { fake, requests }
}

const config = Response.json({
  version: 1,
  clientId: 'teler-cli',
  deviceAuthorizationEndpoint: '/api/auth/device/code',
  deviceTokenEndpoint: '/api/auth/device/token',
  sessionEndpoint: '/api/teler-cli/me',
})
const device = (verification = `${origin}/device`) =>
  Response.json({
    device_code: 'device-secret',
    user_code: 'ABCD2345',
    verification_uri: verification,
    verification_uri_complete: `${verification}?user_code=ABCD2345`,
    expires_in: 60,
    interval: 5,
  })

describe('device authorization', () => {
  it('shows the user code and returns the approved token', async () => {
    const { fake, requests } = deps({
      '/api/teler-cli/config': [config.clone()],
      '/api/auth/device/code': [device()],
      '/api/auth/device/token': [
        Response.json({ error: 'authorization_pending' }, { status: 400 }),
        new Error('offline'),
        Response.json({ error: 'slow_down' }, { status: 400 }),
        new Response('busy', { status: 503 }),
        Response.json({
          access_token: 'sync-token',
          token_type: 'Bearer',
          expires_in: 1,
          scope: '',
        }),
      ],
    })
    const authorization = await startDeviceAuthorization(origin, fake)
    expect(authorization).toMatchObject({ userCode: 'ABCD2345' })
    expect(await authorization.token(new AbortController().signal)).toBe('sync-token')
    const tokenRequest = requests.find((request) => request.url.endsWith('/device/token'))
    expect(tokenRequest?.init?.redirect).toBe('manual')
    expect(String(tokenRequest?.init?.body)).toContain('device-secret')
  })

  it.each([
    ['access_denied', 'connect-denied'],
    ['expired_token', 'connect-expired'],
  ])('maps %s to %s', async (error, code) => {
    const { fake } = deps({
      '/api/teler-cli/config': [config.clone()],
      '/api/auth/device/code': [device()],
      '/api/auth/device/token': [Response.json({ error }, { status: 400 })],
    })
    const authorization = await startDeviceAuthorization(origin, fake)
    await expect(authorization.token(new AbortController().signal)).rejects.toMatchObject({ code })
  })

  it('asks for the token at once, since the app approves its own code', async () => {
    const { fake, requests } = deps({
      '/api/teler-cli/config': [config.clone()],
      '/api/auth/device/code': [device()],
      '/api/auth/device/token': [Response.json({ access_token: 'sync-token' })],
    })
    const authorization = await startDeviceAuthorization(origin, fake)
    expect(await authorization.token(new AbortController().signal)).toBe('sync-token')
    expect(requests.find((request) => request.url.endsWith('/device/token'))?.at).toBe(0)
  })

  it('expires when the user never approves', async () => {
    const pending = () => Response.json({ error: 'authorization_pending' }, { status: 400 })
    const { fake } = deps({
      '/api/teler-cli/config': [config.clone()],
      '/api/auth/device/code': [device()],
      '/api/auth/device/token': Array.from({ length: 20 }, pending),
    })
    const authorization = await startDeviceAuthorization(origin, fake)
    await expect(authorization.token(new AbortController().signal)).rejects.toMatchObject({
      code: 'connect-expired',
    })
  })

  it('stops polling when cancelled', async () => {
    const { fake } = deps({
      '/api/teler-cli/config': [config.clone()],
      '/api/auth/device/code': [device()],
    })
    const authorization = await startDeviceAuthorization(origin, fake)
    const controller = new AbortController()
    controller.abort()
    await expect(authorization.token(controller.signal)).rejects.toThrow()
  })

  it('reports an unreachable server as a network error', async () => {
    const { fake } = deps({ '/api/teler-cli/config': [new Error('ENOTFOUND')] })
    await expect(startDeviceAuthorization(origin, fake)).rejects.toMatchObject({ code: 'network' })
  })
})

describe('sync account', () => {
  it('identifies the account with the bearer token', async () => {
    const { fake, requests } = deps({
      '/api/teler-cli/me': [
        Response.json({ user: { id: 'user_1', name: 'Ana' }, activeOrganizationId: 'org_1' }),
      ],
    })
    await expect(fetchSyncAccount(origin, 'sync-token', fake)).resolves.toMatchObject({
      user: { id: 'user_1', name: 'Ana' },
      activeOrganizationId: 'org_1',
    })
    expect(new Headers(requests[0]?.init?.headers).get('authorization')).toBe('Bearer sync-token')
  })

  it('reports an approved token the API refuses as not eligible for sync', async () => {
    const { fake } = deps({ '/api/teler-cli/me': [new Response('', { status: 401 })] })
    await expect(fetchSyncAccount(origin, 'fresh', fake)).rejects.toMatchObject({
      code: 'not-eligible',
    })
  })
})
