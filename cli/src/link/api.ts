import type { FetchLike } from '../api'
import { ApiError } from '../errors'
import { clientHeaders, CLIENT_ID } from '../version'
import {
  LINK_PROTOCOL_VERSION,
  pairResponseSchema,
  pollResponseSchema,
  type LinkEngine,
  type LinkEngineInfo,
  type LinkFrame,
  type LinkUpFrame,
} from './protocol'

const CLIENT_VERSION = CLIENT_ID.slice(CLIENT_ID.indexOf('/') + 1)

export interface LinkPairing {
  deviceId: string
  secret: string
  organizationId: string
}

/** The poll waits up to this long for a frame; the request allows a little more. */
const POLL_WAIT_SECONDS = 25
const POLL_TIMEOUT_MS = 40_000

async function refusal(response: Response, fallback: string): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as {
    code?: unknown
    error?: unknown
  } | null
  const code =
    typeof body?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(body.code) ? body.code : undefined
  const message =
    typeof body?.error === 'string' && body.error.length <= 300 && !/[\p{Cc}]/u.test(body.error)
      ? body.error
      : fallback
  return new ApiError(message, response.status, code)
}

/** The helper's own routes: a pairing code buys a secret, which then polls and posts frames. */
export class LinkApi {
  constructor(
    private readonly baseUrl: URL,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async pair(input: {
    code: string
    name: string
    platform: string
    engines: readonly LinkEngineInfo[]
  }): Promise<LinkPairing> {
    const response = await this.fetchImpl(new URL('/api/link-device/pair', this.baseUrl).href, {
      method: 'POST',
      headers: { ...clientHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: LINK_PROTOCOL_VERSION,
        clientVersion: CLIENT_VERSION,
        engines: input.engines,
        code: input.code,
        name: input.name,
        platform: input.platform,
      }),
      redirect: 'error',
    })
    if (!response.ok) throw await refusal(response, 'Teler refused the pairing code.')
    return pairResponseSchema.parse(await response.json()).data
  }

  async poll(
    secret: string,
    input: {
      engines: readonly LinkEngineInfo[]
      cursors: ReadonlyArray<{ taskId: string; after: number }>
      signal?: AbortSignal
    }
  ): Promise<{
    frames: LinkFrame[]
    nextUpSeq: Record<string, number>
    chatTurnEngine: LinkEngine | null
  }> {
    const timeout = AbortSignal.timeout(POLL_TIMEOUT_MS)
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
    const response = await this.fetchImpl(new URL('/api/link-device/poll', this.baseUrl).href, {
      method: 'POST',
      headers: this.headers(secret),
      body: JSON.stringify({
        protocol: LINK_PROTOCOL_VERSION,
        clientVersion: CLIENT_VERSION,
        engines: input.engines,
        cursors: input.cursors,
        wait: POLL_WAIT_SECONDS,
      }),
      redirect: 'error',
      signal,
    })
    if (!response.ok) throw await refusal(response, 'Teler refused the poll.')
    return pollResponseSchema.parse(await response.json()).data
  }

  async postFrames(
    secret: string,
    frames: ReadonlyArray<{ taskId: string; seq: number } & LinkUpFrame>
  ): Promise<void> {
    const response = await this.fetchImpl(new URL('/api/link-device/frames', this.baseUrl).href, {
      method: 'POST',
      headers: this.headers(secret),
      body: JSON.stringify({ frames }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw await refusal(response, 'Teler refused the frames.')
  }

  private headers(secret: string): Record<string, string> {
    return {
      ...clientHeaders(),
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    }
  }
}
