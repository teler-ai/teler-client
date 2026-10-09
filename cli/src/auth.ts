import { z } from 'zod'
import { readFile, stat, unlink } from 'node:fs/promises'
import { resolveApiUrl, TelerApiClient, type FetchLike } from './api'
import type { CredentialStore } from './credentials'
import { clientHeaders } from './version'

const configSchema = z.object({
  version: z.literal(1),
  clientId: z.string().min(1),
  deviceAuthorizationEndpoint: z.string().startsWith('/'),
  deviceTokenEndpoint: z.string().startsWith('/'),
  sessionEndpoint: z.string().startsWith('/'),
})

const deviceCodeSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().url(),
  verification_uri_complete: z.string().url(),
  expires_in: z.number().positive(),
  interval: z.number().positive(),
})

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().positive(),
  scope: z.string(),
})

const pendingSchema = z.object({
  error: z.enum(['authorization_pending', 'slow_down', 'access_denied', 'expired_token']),
})

const seededDeviceFileSchema = z.object({
  version: z.literal(1),
  clientId: z.string().min(1),
  deviceCode: z.string().min(32),
  expiresAt: z.iso.datetime(),
})

// `auth status --json` reports the server's account answer as is, including
// fields this CLI does not use.
const meSchema = z.looseObject({
  user: z.object({ id: z.string(), name: z.string().nullable() }),
  activeOrganizationId: z.string().nullable(),
})

export interface LoginDeps {
  fetch?: FetchLike
  store: CredentialStore
  wait?: (milliseconds: number) => Promise<void>
  openBrowser?: (url: string) => void
  write: (text: string) => void
}

async function requestDeviceToken(
  baseUrl: URL,
  endpoint: string,
  clientId: string,
  deviceCode: string,
  fetchImpl: FetchLike
): Promise<Response> {
  return fetchImpl(resolveApiUrl(baseUrl, endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...clientHeaders(),
    },
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: clientId,
    }),
    redirect: 'manual',
  })
}

function defaultOpenBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'linux'
        ? ['xdg-open', url]
        : process.platform === 'win32'
          ? ['cmd', '/c', 'start', '', url]
          : null
  if (!command) return
  try {
    Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' }).unref()
  } catch {
    // The URL and user code are printed below, so browser launch is optional.
  }
}

function formatDeviceUserCode(userCode: string): string {
  return /^[A-Z0-9]{8}$/i.test(userCode) ? `${userCode.slice(0, 4)}-${userCode.slice(4)}` : userCode
}

export async function login(baseUrl: URL, deps: LoginDeps): Promise<void> {
  const client = new TelerApiClient(baseUrl, undefined, deps.fetch)
  const config = await client.json('/api/teler-cli/config', configSchema)
  const device = await client.json(config.deviceAuthorizationEndpoint, deviceCodeSchema, {
    method: 'POST',
    body: JSON.stringify({ client_id: config.clientId, scope: 'openid profile' }),
  })

  // Keep the user code out of the browser URL. Requiring the user to copy it
  // from the terminal provides an explicit device-to-browser verification step.
  ;(deps.openBrowser ?? defaultOpenBrowser)(device.verification_uri)
  deps.write(
    `Open ${device.verification_uri}\nEnter code: ${formatDeviceUserCode(device.user_code)}\n`
  )

  const deadline = Date.now() + device.expires_in * 1000
  let intervalSeconds = device.interval
  const wait = deps.wait ?? ((milliseconds) => Bun.sleep(milliseconds))
  const fetchImpl = deps.fetch ?? fetch
  while (Date.now() < deadline) {
    await wait(intervalSeconds * 1000)
    let response: Response
    try {
      response = await requestDeviceToken(
        baseUrl,
        config.deviceTokenEndpoint,
        config.clientId,
        device.device_code,
        fetchImpl
      )
    } catch {
      // Device authorization is a bounded polling flow. A temporary network
      // failure should not discard an authorization the user may have completed.
      continue
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Teler API refused an authentication redirect')
    }
    if (response.status >= 500) continue

    const payload = (await response.json()) as unknown
    if (response.ok) {
      const token = tokenSchema.parse(payload)
      await deps.store.set(baseUrl.origin, token.access_token)
      deps.write(`Authenticated with ${baseUrl.origin}.\n`)
      return
    }

    // RFC 8628 polling errors are control flow. Only a fixed enum is inspected;
    // no untrusted response text is printed.
    const pending = pendingSchema.safeParse(payload)
    if (!pending.success) throw new Error('Device login failed')
    if (pending.data.error === 'authorization_pending') continue
    if (pending.data.error === 'slow_down') {
      intervalSeconds += 5
      continue
    }
    throw new Error('Device login was denied or expired')
  }
  throw new Error('Device login expired')
}

export async function loginWithDeviceFile(
  baseUrl: URL,
  path: string,
  deps: LoginDeps
): Promise<void> {
  let file: z.infer<typeof seededDeviceFileSchema>
  try {
    const metadata = await stat(path)
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new Error('insecure permissions')
    }
    file = seededDeviceFileSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    throw new Error('Seeded CLI device file is missing, invalid, or not private')
  }
  if (new Date(file.expiresAt).getTime() <= Date.now()) {
    throw new Error('Seeded CLI device authorization has expired')
  }

  const client = new TelerApiClient(baseUrl, undefined, deps.fetch)
  const config = await client.json('/api/teler-cli/config', configSchema)
  if (file.clientId !== config.clientId) {
    throw new Error('Seeded CLI device authorization is for a different client')
  }

  const response = await requestDeviceToken(
    baseUrl,
    config.deviceTokenEndpoint,
    file.clientId,
    file.deviceCode,
    deps.fetch ?? fetch
  )
  if (response.status >= 300 && response.status < 400) {
    throw new Error('Teler API refused an authentication redirect')
  }
  if (!response.ok) throw new Error('Seeded CLI device authorization was denied or expired')

  const token = tokenSchema.parse((await response.json()) as unknown)
  await deps.store.set(baseUrl.origin, token.access_token)
  await unlink(path).catch(() => undefined)
  deps.write(`Authenticated with ${baseUrl.origin}.\n`)
}

export async function authStatus(baseUrl: URL, token: string, fetchImpl?: FetchLike) {
  const client = new TelerApiClient(baseUrl, token, fetchImpl)
  return client.json('/api/teler-cli/me', meSchema)
}

export async function logout(
  baseUrl: URL,
  token: string,
  store: CredentialStore,
  options: { deleteStoredCredential: boolean; fetch?: FetchLike }
): Promise<void> {
  try {
    await new TelerApiClient(baseUrl, token, options.fetch).request('/api/auth/sign-out', {
      method: 'POST',
      body: '{}',
    })
  } finally {
    if (options.deleteStoredCredential) await store.delete(baseUrl.origin)
  }
}
