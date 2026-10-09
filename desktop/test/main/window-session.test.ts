import { describe, expect, it } from 'vitest'
import { DeviceLoginError } from '../../src/main/device-login'
import {
  approveWithWindowSession,
  isSessionCookie,
  listOrganizations,
  readWindowSession,
} from '../../src/main/window-session'

const authOrigin = 'https://app.teler.ai'

function server(replies: Record<string, Response | Error>) {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const fetch = async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    const reply = replies[new URL(url).pathname]
    if (!reply) throw new Error(`unexpected request ${url}`)
    if (reply instanceof Error) throw reply
    return reply.clone()
  }
  return { fetch, requests }
}

const organizations = Response.json({
  success: true,
  data: [
    { id: 'org_a', name: 'Acme', role: 'owner' },
    { id: 'org_b', name: 'Beta', role: 'member' },
  ],
})
const approved = Response.json({ success: true, data: { approved: true } })
// Teler returns `client_id` only to the account that claimed the code.
const claimed = Response.json({ user_code: 'ABCD-2345', status: 'pending', client_id: 'teler-cli' })

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(DeviceLoginError)
  return (error as DeviceLoginError).code
}

describe('approving sync with the window session', () => {
  it('claims the device code, then approves it for every organization of the account', async () => {
    const { fetch, requests } = server({
      '/api/user/organizations': organizations,
      '/api/auth/device': claimed,
      '/api/user/cli-tokens/device/approve': approved,
    })
    await approveWithWindowSession(authOrigin, 'ABCD-2345', fetch)
    // Like the `/device` page: the claim assigns the code to the signed-in
    // account, and only that account can approve it.
    expect(requests.map((request) => request.url)).toEqual([
      `${authOrigin}/api/user/organizations`,
      `${authOrigin}/api/auth/device?user_code=ABCD-2345`,
      `${authOrigin}/api/user/cli-tokens/device/approve`,
    ])
    const approval = requests[2]!.init!
    expect(approval.method).toBe('POST')
    expect(JSON.parse(String(approval.body))).toEqual({
      userCode: 'ABCD-2345',
      organizationIds: ['org_a', 'org_b'],
    })
    // The approval endpoint accepts only browser sessions, never a bearer token.
    for (const request of requests) {
      expect(new Headers(request.init?.headers).has('Authorization')).toBe(false)
      expect(request.init?.redirect).toBe('manual')
    }
  })

  it('needs someone signed in to Teler', async () => {
    const signedOut = server({
      '/api/user/organizations': Response.json({ success: false }, { status: 401 }),
    })
    expect(await failure(approveWithWindowSession(authOrigin, 'CODE', signedOut.fetch))).toBe(
      'signed-out'
    )
    const redirected = server({
      '/api/user/organizations': new Response(null, { status: 302 }),
    })
    expect(await failure(approveWithWindowSession(authOrigin, 'CODE', redirected.fetch))).toBe(
      'signed-out'
    )
  })

  it('reports accounts without organizations or without CLI access', async () => {
    const empty = server({ '/api/user/organizations': Response.json({ success: true, data: [] }) })
    expect(await failure(approveWithWindowSession(authOrigin, 'CODE', empty.fetch))).toBe(
      'no-organization'
    )
    // The claim refuses accounts that cannot authorize the CLI (unverified email).
    const unverified = server({
      '/api/user/organizations': organizations,
      '/api/auth/device': Response.json({ code: 'TELER_CLI_ACCESS_DENIED' }, { status: 403 }),
    })
    expect(await failure(approveWithWindowSession(authOrigin, 'CODE', unverified.fetch))).toBe(
      'not-eligible'
    )
  })

  it('does not approve a code it could not claim for this account', async () => {
    for (const reply of [
      // Claimed by someone else: no client_id for this account.
      Response.json({ user_code: 'CODE', status: 'pending' }),
      Response.json({ user_code: 'CODE', status: 'approved', client_id: 'teler-cli' }),
      Response.json({ user_code: 'CODE', status: 'pending', client_id: 'other-client' }),
    ]) {
      const { fetch, requests } = server({
        '/api/user/organizations': organizations,
        '/api/auth/device': reply,
      })
      expect(await failure(approveWithWindowSession(authOrigin, 'CODE', fetch))).toBe(
        'connect-failed'
      )
      expect(requests.some((request) => request.url.endsWith('/approve'))).toBe(false)
    }
  })

  it('asks to try again when a membership changes before the approval', async () => {
    const raced = server({
      '/api/user/organizations': organizations,
      '/api/auth/device': claimed,
      '/api/user/cli-tokens/device/approve': Response.json({}, { status: 403 }),
    })
    expect(await failure(approveWithWindowSession(authOrigin, 'CODE', raced.fetch))).toBe(
      'connect-failed'
    )
  })

  it('maps an unknown code, server errors and network failures', async () => {
    const expired = server({
      '/api/user/organizations': organizations,
      '/api/auth/device': Response.json({ error: 'expired_token' }, { status: 400 }),
    })
    expect(await failure(approveWithWindowSession(authOrigin, 'CODE', expired.fetch))).toBe(
      'connect-expired'
    )
    const gone = server({
      '/api/user/organizations': organizations,
      '/api/auth/device': claimed,
      '/api/user/cli-tokens/device/approve': Response.json({}, { status: 404 }),
    })
    expect(await failure(approveWithWindowSession(authOrigin, 'CODE', gone.fetch))).toBe(
      'connect-expired'
    )
    const down = server({
      '/api/user/organizations': organizations,
      '/api/auth/device': claimed,
      '/api/user/cli-tokens/device/approve': new Response('down', { status: 502 }),
    })
    expect(await failure(approveWithWindowSession(authOrigin, 'CODE', down.fetch))).toBe('network')
    const offline = server({ '/api/user/organizations': new Error('offline') })
    expect(await failure(approveWithWindowSession(authOrigin, 'CODE', offline.fetch))).toBe(
      'network'
    )
  })
})

describe('reading the window session', () => {
  it('returns the signed-in account, or null when signed out', async () => {
    const signedIn = server({
      '/api/auth/get-session': Response.json({
        session: { id: 'session' },
        user: { id: 'user_1', name: 'Ana' },
      }),
    })
    expect(await readWindowSession(authOrigin, signedIn.fetch)).toEqual({
      id: 'user_1',
      activeOrganizationId: null,
    })
    const inOrganization = server({
      '/api/auth/get-session': Response.json({
        session: { id: 'session', activeOrganizationId: 'org_b' },
        user: { id: 'user_1' },
      }),
    })
    expect(await readWindowSession(authOrigin, inOrganization.fetch)).toEqual({
      id: 'user_1',
      activeOrganizationId: 'org_b',
    })
    expect(signedIn.requests[0]!.url).toBe(`${authOrigin}/api/auth/get-session`)
    const signedOut = server({ '/api/auth/get-session': Response.json(null) })
    expect(await readWindowSession(authOrigin, signedOut.fetch)).toBeNull()
  })

  it('is unknown when the session cannot be read', async () => {
    for (const reply of [
      new Error('offline'),
      new Response('Access', { status: 403 }),
      new Response('<html>', { status: 200 }),
      new Response(null, { status: 302 }),
    ])
      expect(
        await readWindowSession(authOrigin, server({ '/api/auth/get-session': reply }).fetch)
      ).toBeUndefined()
  })

  it('lists the organizations of the signed-in account by name', async () => {
    const listed = server({ '/api/user/organizations': organizations })
    expect(await listOrganizations(authOrigin, listed.fetch)).toEqual([
      { id: 'org_a', name: 'Acme' },
      { id: 'org_b', name: 'Beta' },
    ])
    const signedOut = server({
      '/api/user/organizations': Response.json({ success: false }, { status: 401 }),
    })
    expect(await listOrganizations(authOrigin, signedOut.fetch)).toEqual([])
    const offline = server({ '/api/user/organizations': new Error('offline') })
    expect(await listOrganizations(authOrigin, offline.fetch)).toBeUndefined()
  })

  it('recognizes Teler session cookies under any prefix', () => {
    expect(isSessionCookie('teler.session_token')).toBe(true)
    expect(isSessionCookie('__Secure-example.session_token')).toBe(true)
    expect(isSessionCookie('local.session_token')).toBe(true)
    expect(isSessionCookie('teler.session_data')).toBe(false)
    expect(isSessionCookie('CF_Authorization')).toBe(false)
    expect(isSessionCookie('teler-language')).toBe(false)
  })
})
