import { DOWNLOAD_PREFIX } from '../src/releases'

export interface FakeRelease {
  tag: string
  draft?: boolean
  prerelease?: boolean
  assets?: Record<string, number>
}

/** A GitHub releases listing, as the API returns it. */
export function releaseListing(releases: FakeRelease[]) {
  return releases.map((release) => ({
    tag_name: release.tag,
    html_url: `https://github.com/teler-ai/teler-client/releases/tag/${release.tag}`,
    draft: release.draft ?? false,
    prerelease: release.prerelease ?? false,
    assets: Object.entries(release.assets ?? {}).map(([name, size]) => ({
      name,
      browser_download_url: `${DOWNLOAD_PREFIX}${release.tag}/${name}`,
      size,
    })),
  }))
}

/** Serves the listing and the given downloads; records every requested URL. */
export function releaseServer(
  listing: unknown,
  downloads: Record<string, Uint8Array | string> = {}
) {
  const requests: { url: string; init?: RequestInit }[] = []
  const fetch = async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    if (url.startsWith('https://api.github.com/')) return Response.json(listing)
    const name = url.slice(url.lastIndexOf('/') + 1)
    const body = downloads[name]
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(body)
  }
  return { fetch, requests }
}
