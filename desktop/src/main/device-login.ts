import { z } from 'zod'
import type { DesktopErrorCode } from '../shared/desktop-api'

/**
 * RFC 8628 device authorization for folder sync, mirroring `teler auth login`.
 * The app approves its own code with the Teler window's session
 * (`window-session.ts`), so the user never sees it.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const configSchema = z.object({
  version: z.literal(1),
  clientId: z.string().min(1),
  deviceAuthorizationEndpoint: z.string().startsWith('/'),
  deviceTokenEndpoint: z.string().startsWith('/'),
  sessionEndpoint: z.string().startsWith('/'),
})
const deviceSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  expires_in: z.number().positive(),
  interval: z.number().positive(),
})
const tokenSchema = z.object({ access_token: z.string().min(1) })
const pendingSchema = z.object({
  error: z.enum(['authorization_pending', 'slow_down', 'access_denied', 'expired_token']),
})
const accountSchema = z.object({
  user: z.object({ id: z.string(), name: z.string().nullable() }),
  activeOrganizationId: z.string().nullable(),
})

export type SyncAccountDetails = z.infer<typeof accountSchema>

export class DeviceLoginError extends Error {
  constructor(readonly code: DesktopErrorCode) {
    super(`Folder sync connection failed: ${code}`)
    this.name = 'DeviceLoginError'
  }
}

export interface DeviceLoginDeps {
  fetch: FetchLike
  wait(milliseconds: number, signal: AbortSignal): Promise<void>
  now(): number
}

export interface DeviceAuthorization {
  userCode: string
  expiresAt: number
  /** Polls until the user approves and resolves with the sync access token. */
  token(signal: AbortSignal): Promise<string>
}

async function requestJson<T>(
  deps: DeviceLoginDeps,
  url: string,
  schema: z.ZodType<T>,
  init: RequestInit = {}
): Promise<T> {
  let response: Response
  try {
    response = await deps.fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
    })
  } catch {
    throw new DeviceLoginError('network')
  }
  if (response.status === 401 || response.status === 403)
    throw new DeviceLoginError('not-connected')
  if (!response.ok)
    throw new DeviceLoginError(response.status >= 500 ? 'network' : 'connect-failed')
  const parsed = schema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new DeviceLoginError('connect-failed')
  return parsed.data
}

export async function startDeviceAuthorization(
  origin: string,
  deps: DeviceLoginDeps
): Promise<DeviceAuthorization> {
  const config = await requestJson(deps, `${origin}/api/teler-cli/config`, configSchema)
  const device = await requestJson(
    deps,
    `${origin}${config.deviceAuthorizationEndpoint}`,
    deviceSchema,
    {
      method: 'POST',
      body: JSON.stringify({ client_id: config.clientId, scope: 'openid profile' }),
    }
  )
  const expiresAt = deps.now() + device.expires_in * 1000

  async function token(signal: AbortSignal): Promise<string> {
    let interval = device.interval
    // The code is approved before polling starts, so the first request goes at once.
    let first = true
    while (deps.now() < expiresAt) {
      if (!first) await deps.wait(interval * 1000, signal)
      first = false
      signal.throwIfAborted()
      let response: Response
      try {
        response = await deps.fetch(`${origin}${config.deviceTokenEndpoint}`, {
          method: 'POST',
          redirect: 'manual',
          signal,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: device.device_code,
            client_id: config.clientId,
          }),
        })
      } catch {
        signal.throwIfAborted()
        // Polling is bounded; a transient failure must not lose an approval.
        continue
      }
      if (response.status >= 300 && response.status < 400)
        throw new DeviceLoginError('connect-failed')
      if (response.status >= 500) continue
      const payload: unknown = await response.json().catch(() => null)
      if (response.ok) {
        const parsed = tokenSchema.safeParse(payload)
        if (!parsed.success) throw new DeviceLoginError('connect-failed')
        return parsed.data.access_token
      }
      const pending = pendingSchema.safeParse(payload)
      if (!pending.success) throw new DeviceLoginError('connect-failed')
      if (pending.data.error === 'slow_down') interval += 5
      else if (pending.data.error === 'access_denied') throw new DeviceLoginError('connect-denied')
      else if (pending.data.error === 'expired_token') throw new DeviceLoginError('connect-expired')
    }
    throw new DeviceLoginError('connect-expired')
  }

  return { userCode: device.user_code, expiresAt, token }
}

/**
 * Identifies the account and organization a newly approved token acts for.
 * Teler refuses a fresh token only when the account cannot use folder sync
 * (for example an unverified account), so sync is `not-eligible`.
 */
export async function fetchSyncAccount(origin: string, token: string, deps: DeviceLoginDeps) {
  try {
    return await requestJson(deps, `${origin}/api/teler-cli/me`, accountSchema, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    if (error instanceof DeviceLoginError && error.code === 'not-connected')
      throw new DeviceLoginError('not-eligible')
    throw error
  }
}

/** Ends the token's server-side session; best effort when disconnecting. */
export async function revokeSyncToken(origin: string, token: string, deps: DeviceLoginDeps) {
  await deps
    .fetch(`${origin}/api/auth/sign-out`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    .catch(() => undefined)
}
