import { z } from 'zod'
import type { OrganizationSummary } from '../shared/desktop-api'
import { DeviceLoginError, type FetchLike } from './device-login'

/**
 * One-click folder sync: the main process claims and approves its own device
 * code with the session of the Teler window (the same requests the `/device`
 * page makes), so the user never sees a code. The device grant still issues a
 * separate, organization-scoped sync token; the window session itself never
 * leaves the app's session cookies.
 *
 * `fetch` sends the window session's cookies (`credentials: 'include'`).
 */

const organizationsSchema = z.object({
  success: z.literal(true),
  data: z.array(z.object({ id: z.string().min(1) })),
})
const claimSchema = z.object({
  status: z.string(),
  /** Returned only to the account that claimed the code. */
  client_id: z.string().optional(),
})
const namedOrganizationsSchema = z.object({
  success: z.literal(true),
  data: z.array(z.object({ id: z.string().min(1), name: z.string() })),
})
const sessionSchema = z.union([
  z.null(),
  z.object({
    user: z.object({ id: z.string().min(1) }),
    session: z.object({ activeOrganizationId: z.string().nullish() }).optional(),
  }),
])

/** The approval endpoint accepts at most this many organizations. */
const MAX_ORGANIZATIONS = 100
/** The device grant's client, which the code must belong to. */
const CLI_CLIENT_ID = 'teler-cli'

/** The signed-in account and the organization open in the window, or null when signed out. */
export type SessionUser = { id: string; activeOrganizationId?: string | null } | null

async function send(fetch: FetchLike, url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    })
  } catch {
    throw new DeviceLoginError('network')
  }
}

/** A redirect to sign-in, such as Cloudflare Access's, however fetch reports it. */
function isRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)
}

/**
 * Claims `userCode` for the account signed in to the window, as the `/device`
 * page does when it opens: a new code belongs to no one until it is claimed,
 * and only the account that claimed it can approve it.
 */
async function claimDeviceCode(authOrigin: string, userCode: string, fetch: FetchLike) {
  const claim = await send(
    fetch,
    `${authOrigin}/api/auth/device?user_code=${encodeURIComponent(userCode)}`
  )
  if (claim.status === 401 || isRedirect(claim)) throw new DeviceLoginError('signed-out')
  // Teler refuses accounts that cannot authorize the CLI (an unverified email).
  if (claim.status === 403) throw new DeviceLoginError('not-eligible')
  if (claim.status === 400) throw new DeviceLoginError('connect-expired')
  if (!claim.ok) throw new DeviceLoginError(claim.status >= 500 ? 'network' : 'connect-failed')
  const parsed = claimSchema.safeParse(await claim.json().catch(() => null))
  if (
    !parsed.success ||
    parsed.data.status !== 'pending' ||
    parsed.data.client_id !== CLI_CLIENT_ID
  )
    throw new DeviceLoginError('connect-failed')
}

/** Claims and approves `userCode` for every organization of the account signed in to the window. */
export async function approveWithWindowSession(
  authOrigin: string,
  userCode: string,
  fetch: FetchLike
): Promise<void> {
  const listed = await send(fetch, `${authOrigin}/api/user/organizations`)
  // Signed out: 401, or a redirect to sign-in from a proxy in front of Teler.
  if (listed.status === 401 || isRedirect(listed)) throw new DeviceLoginError('signed-out')
  if (!listed.ok) throw new DeviceLoginError(listed.status >= 500 ? 'network' : 'connect-failed')
  const organizations = organizationsSchema.safeParse(await listed.json().catch(() => null))
  if (!organizations.success) throw new DeviceLoginError('connect-failed')
  if (organizations.data.data.length === 0) throw new DeviceLoginError('no-organization')
  await claimDeviceCode(authOrigin, userCode, fetch)

  const approval = await send(fetch, `${authOrigin}/api/user/cli-tokens/device/approve`, {
    method: 'POST',
    body: JSON.stringify({
      userCode,
      organizationIds: organizations.data.data
        .slice(0, MAX_ORGANIZATIONS)
        .map((organization) => organization.id),
    }),
  })
  if (approval.ok) return
  if (approval.status === 401 || isRedirect(approval)) throw new DeviceLoginError('signed-out')
  // The claim already checked CLI access, so a refusal here means a membership
  // changed since the organizations were listed; connecting again fixes it.
  if (approval.status === 404) throw new DeviceLoginError('connect-expired')
  throw new DeviceLoginError(approval.status >= 500 ? 'network' : 'connect-failed')
}

/**
 * The account signed in to the window: `null` when signed out, `undefined`
 * when it cannot be told right now (offline, or a proxy answered instead).
 */
export async function readWindowSession(
  authOrigin: string,
  fetch: FetchLike
): Promise<SessionUser | undefined> {
  try {
    const response = await fetch(`${authOrigin}/api/auth/get-session`, {
      redirect: 'manual',
      headers: { Accept: 'application/json' },
    })
    if (response.status !== 200) return undefined
    const parsed = sessionSchema.safeParse(await response.json())
    if (!parsed.success) return undefined
    return (
      parsed.data && {
        id: parsed.data.user.id,
        activeOrganizationId: parsed.data.session?.activeOrganizationId ?? null,
      }
    )
  } catch {
    return undefined
  }
}

/**
 * The signed-in account's organizations, to show and choose where folders
 * sync: empty when signed out, `undefined` when they cannot be read now.
 */
export async function listOrganizations(
  authOrigin: string,
  fetch: FetchLike
): Promise<OrganizationSummary[] | undefined> {
  let response: Response
  try {
    response = await send(fetch, `${authOrigin}/api/user/organizations`)
  } catch {
    return undefined
  }
  if (response.status === 401 || isRedirect(response)) return []
  if (!response.ok) return undefined
  const parsed = namedOrganizationsSchema.safeParse(await response.json().catch(() => null))
  return parsed.success ? parsed.data.data.map(({ id, name }) => ({ id, name })) : undefined
}

/** The Teler session cookie, whatever its configured prefix. */
export function isSessionCookie(name: string): boolean {
  return name.endsWith('.session_token')
}
