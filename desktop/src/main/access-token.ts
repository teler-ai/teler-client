/** The cookie Cloudflare Access sets on a protected origin after its login. */
export const ACCESS_COOKIE = 'CF_Authorization'

/** The part of Electron's `session.cookies` the token needs. */
export interface CookieJar {
  get(filter: { url: string; name: string }): Promise<Array<{ value: string }>>
  on(event: 'changed', listener: (event: unknown, cookie: { name: string }) => void): unknown
}

/**
 * The Cloudflare Access token in the app's session, for an origin behind
 * Access. The window's Access login sets it; sync then passes
 * Access with it: main-process requests send it as `cf-access-token` and the
 * sidecar gets `TELER_ACCESS_TOKEN`. Origins without Access never have one.
 */
export class AccessToken {
  private value: string | null = null

  constructor(
    private readonly origin: string,
    private readonly cookies: CookieJar
  ) {}

  get current(): string | null {
    return this.value
  }

  /** Reads the token, then calls `onChange` when a renewal or expiry changes it. */
  async watch(onChange: () => void): Promise<void> {
    this.cookies.on('changed', (_event, cookie) => {
      if (cookie.name === ACCESS_COOKIE) void this.read().then((changed) => changed && onChange())
    })
    await this.read()
  }

  private async read(): Promise<boolean> {
    const cookies = await this.cookies
      .get({ url: this.origin, name: ACCESS_COOKIE })
      .catch(() => [])
    const next = cookies[0]?.value || null
    const changed = next !== this.value
    this.value = next
    return changed
  }
}

/** Adds the Access token to a main-process request for the Teler origin. */
export function withAccessHeader(
  init: RequestInit | undefined,
  url: string,
  origin: string,
  token: string | null
): RequestInit | undefined {
  if (!token || new URL(url).origin !== origin) return init
  const headers = new Headers(init?.headers)
  headers.set('cf-access-token', token)
  return { ...init, headers }
}
