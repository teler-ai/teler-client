import type { FetchLike } from './api'
import { resolveTelerUrl } from './url'

/**
 * Lets the CLI reach an origin behind Cloudflare Access: `TELER_ACCESS_TOKEN`
 * (for example from `cloudflared access token`, or Teler Desktop's Access
 * session) is sent as `cf-access-token`, only to the configured origin.
 */
export function withAccessToken(
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike | undefined
): FetchLike | undefined {
  const token = env.TELER_ACCESS_TOKEN?.trim()
  if (!token) return fetchImpl
  const origin = resolveTelerUrl(env).origin
  const next = fetchImpl ?? fetch
  return (input, init) => {
    if (new URL(input).origin !== origin) return next(input, init)
    const headers = new Headers(init?.headers)
    headers.set('cf-access-token', token)
    return next(input, { ...init, headers })
  }
}
