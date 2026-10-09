import { describe, expect, it } from 'bun:test'
import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authStatus, login, loginWithDeviceFile } from '../src/auth'
import type { CredentialStore } from '../src/credentials'

describe('device login', () => {
  it('redeems and removes a private seeded device file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'teler-cli-device-'))
    const path = join(directory, 'device.json')
    await writeFile(
      path,
      `${JSON.stringify({
        version: 1,
        clientId: 'teler-cli',
        deviceCode: 'seeded-device-secret-0123456789abcdef',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })}\n`,
      { mode: 0o600 }
    )
    await chmod(path, 0o600)
    const writes: string[] = []
    const stored: Array<[string, string]> = []

    try {
      await loginWithDeviceFile(new URL('https://app.teler.example'), path, {
        store: {
          get: async () => null,
          set: async (resource, token) => void stored.push([resource, token]),
          delete: async () => undefined,
        },
        write: (text) => writes.push(text),
        fetch: async (input) => {
          const pathname = new URL(input).pathname
          if (pathname === '/api/teler-cli/config') {
            return Response.json({
              version: 1,
              clientId: 'teler-cli',
              deviceAuthorizationEndpoint: '/api/auth/device/code',
              deviceTokenEndpoint: '/api/auth/device/token',
              sessionEndpoint: '/api/teler-cli/me',
            })
          }
          expect(pathname).toBe('/api/auth/device/token')
          return Response.json({
            access_token: 'session-secret',
            token_type: 'Bearer',
            expires_in: 86400,
            scope: 'openid profile',
          })
        },
      })

      expect(stored).toEqual([['https://app.teler.example', 'session-secret']])
      expect(writes.join('')).toContain('Authenticated with https://app.teler.example.')
      expect(writes.join('')).not.toContain('seeded-device-secret')
      expect(writes.join('')).not.toContain('session-secret')
      await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('stores the approved token under the resource origin', async () => {
    const writes: string[] = []
    const stored: Array<[string, string]> = []
    const store: CredentialStore = {
      get: async () => null,
      set: async (resource, token) => void stored.push([resource, token]),
      delete: async () => undefined,
    }
    let tokenPolls = 0
    const openedUrls: string[] = []
    await login(new URL('https://app.teler.example'), {
      store,
      write: (text) => writes.push(text),
      wait: async () => undefined,
      openBrowser: (url) => openedUrls.push(url),
      fetch: async (input) => {
        const path = new URL(input).pathname
        if (path === '/api/teler-cli/config') {
          return Response.json({
            version: 1,
            clientId: 'teler-cli',
            deviceAuthorizationEndpoint: '/api/auth/device/code',
            deviceTokenEndpoint: '/api/auth/device/token',
            sessionEndpoint: '/api/teler-cli/me',
          })
        }
        if (path.endsWith('/device/code')) {
          return Response.json({
            device_code: 'device-secret',
            user_code: 'ABCD1234',
            verification_uri: 'https://auth.teler.example/device',
            verification_uri_complete: 'https://auth.teler.example/device?user_code=ABCD-1234',
            expires_in: 600,
            interval: 1,
          })
        }
        tokenPolls += 1
        return Response.json({
          access_token: 'session-secret',
          token_type: 'Bearer',
          expires_in: 86400,
          scope: 'openid profile',
        })
      },
    })
    expect(tokenPolls).toBe(1)
    expect(openedUrls).toEqual(['https://auth.teler.example/device'])
    expect(stored).toEqual([['https://app.teler.example', 'session-secret']])
    expect(writes.join('')).toContain('Enter code: ABCD-1234')
    expect(writes.join('')).not.toContain('session-secret')
    expect(writes.join('')).not.toContain('device-secret')
  })

  it('retries a transient gateway failure while authorization is pending', async () => {
    const writes: string[] = []
    const stored: Array<[string, string]> = []
    const store: CredentialStore = {
      get: async () => null,
      set: async (resource, token) => void stored.push([resource, token]),
      delete: async () => undefined,
    }
    let tokenPolls = 0

    await login(new URL('https://app.teler.example'), {
      store,
      write: (text) => writes.push(text),
      wait: async () => undefined,
      openBrowser: () => undefined,
      fetch: async (input) => {
        const path = new URL(input).pathname
        if (path === '/api/teler-cli/config') {
          return Response.json({
            version: 1,
            clientId: 'teler-cli',
            deviceAuthorizationEndpoint: '/api/auth/device/code',
            deviceTokenEndpoint: '/api/auth/device/token',
            sessionEndpoint: '/api/teler-cli/me',
          })
        }
        if (path.endsWith('/device/code')) {
          return Response.json({
            device_code: 'device-secret',
            user_code: 'ABCD1234',
            verification_uri: 'https://auth.teler.example/device',
            verification_uri_complete: 'https://auth.teler.example/device?user_code=ABCD-1234',
            expires_in: 600,
            interval: 1,
          })
        }

        tokenPolls += 1
        if (tokenPolls === 1) {
          return Response.json({ error: 'authorization_pending' }, { status: 400 })
        }
        if (tokenPolls === 2) return new Response(null, { status: 502 })
        return Response.json({
          access_token: 'session-secret',
          token_type: 'Bearer',
          expires_in: 86400,
          scope: 'openid profile',
        })
      },
    })

    expect(tokenPolls).toBe(3)
    expect(stored).toEqual([['https://app.teler.example', 'session-secret']])
    expect(writes.join('')).not.toContain('session-secret')
    expect(writes.join('')).not.toContain('device-secret')
  })
})

describe('auth status', () => {
  it('reports the signed-in account and keeps fields this CLI does not model', async () => {
    const account = {
      user: { id: 'user_1', name: 'Ana' },
      activeOrganizationId: 'org_1',
      newerServerField: 'kept',
    }
    const status = await authStatus(new URL('https://teler.example'), 'token', async () =>
      Response.json(account)
    )
    expect(status).toEqual(account)
  })
})
