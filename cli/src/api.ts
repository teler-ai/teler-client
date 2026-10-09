import { z } from 'zod'
import { ApiError } from './errors'
import { clientHeaders } from './version'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Teler no longer supports this CLI version (HTTP 426). */
export const UPDATE_REQUIRED = 'CLIENT_UPDATE_REQUIRED'
const minVersionSchema = z.object({ minVersion: z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/) })

async function updateRequiredMessage(response: Response): Promise<string> {
  const body = await response
    .clone()
    .json()
    .catch(() => null)
  const parsed = minVersionSchema.safeParse(body)
  const version = parsed.success ? ` to ${parsed.data.minVersion} or later` : ''
  return `This version of the teler CLI is no longer supported. Update the teler CLI${version}.`
}

const errorSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Z0-9_]{1,64}$/)
    .optional(),
})
// Only plain capability ids; a malformed list is dropped, never echoed.
const capabilitiesSchema = z.object({
  capabilities: z
    .array(z.string().regex(/^[a-z]+(?:\.[a-z]+)+$/))
    .max(64)
    .optional(),
})

const MAX_RETRY_AFTER_MS = 15 * 60_000

function retryAfterMilliseconds(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return undefined
  // The server's whole wait: sync must send nothing until it passes (bounded).
  return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS)
}

export function resolveApiUrl(baseUrl: URL, path: string): string {
  let resolved: URL
  try {
    resolved = new URL(path, baseUrl)
  } catch {
    throw new ApiError('Teler API returned an invalid endpoint', 502)
  }
  if (!path.startsWith('/') || path.startsWith('//') || resolved.origin !== baseUrl.origin) {
    throw new ApiError('Teler API endpoint escaped the configured origin', 502)
  }
  return resolved.toString()
}

export class TelerApiClient {
  constructor(
    readonly baseUrl: URL,
    private readonly token: string | undefined,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    for (const [name, value] of Object.entries(clientHeaders())) headers.set(name, value)
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    const endpoint = resolveApiUrl(this.baseUrl, path)
    let response: Response
    try {
      response = await this.fetchImpl(endpoint, {
        ...init,
        headers,
        redirect: 'manual',
      })
    } catch {
      // Fetch implementations may embed URLs, authorization or provider text.
      throw new ApiError('Teler API request could not be completed', 503, 'NETWORK')
    }
    if (response.status >= 300 && response.status < 400) {
      throw new ApiError('Teler API refused an authentication redirect', response.status)
    }
    if (!response.ok) {
      let code: string | undefined
      let capabilities: string[] | undefined
      try {
        const body = (await response.clone().json()) as unknown
        const parsed = errorSchema.safeParse(body)
        code = parsed.success ? parsed.data.code : undefined
        const named = capabilitiesSchema.safeParse(body)
        capabilities = named.success ? named.data.capabilities : undefined
      } catch {
        // Status is the safe fallback. Never echo an untrusted response body.
      }
      if (code === UPDATE_REQUIRED) {
        throw new ApiError(await updateRequiredMessage(response), response.status, code)
      }
      throw new ApiError(
        `Teler API request failed (${response.status}${code ? ` ${code}` : ''})`,
        response.status,
        code,
        retryAfterMilliseconds(response.headers.get('Retry-After')),
        capabilities
      )
    }
    return response
  }

  async json<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init)
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new ApiError('Teler API returned an invalid response', 502)
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success) throw new ApiError('Teler API returned an invalid response', 502)
    return parsed.data
  }
}
