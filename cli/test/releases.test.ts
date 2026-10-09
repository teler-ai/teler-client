import { describe, expect, test } from 'bun:test'
import { compareVersions, isNewer, latestRelease } from '../src/releases'
import { releaseListing, releaseServer } from './release-fixtures'

describe('version order', () => {
  test('compares numerically and puts a prerelease before its release', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0-nightly.9', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0-nightly.10', '1.0.0-nightly.9')).toBe(1)
    expect(compareVersions('1.0.0-nightly.1.2', '1.0.0-nightly.1')).toBe(1)
  })

  test('never treats an invalid version as newer', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('latest', '0.1.0')).toBe(false)
    expect(isNewer('0.2.0', 'dev')).toBe(false)
  })
})

describe('latest release', () => {
  test('picks the newest published release of the product', async () => {
    const { fetch, requests } = releaseServer(
      releaseListing([
        { tag: 'desktop-v9.0.0', assets: { 'Teler-9.0.0-win-x64.exe': 10 } },
        { tag: 'cli-v0.3.0', draft: true },
        { tag: 'cli-v0.4.0-nightly.3', prerelease: true },
        { tag: 'cli-vnext' },
        { tag: 'cli-v0.2.0', assets: { 'teler-linux-x64': 10 } },
        { tag: 'cli-v0.10.0', assets: { 'teler-linux-x64': 20, 'SHA256SUMS.txt': 1 } },
      ])
    )
    const release = await latestRelease('cli', { fetch, userAgent: 'test-agent' })
    expect(release?.version).toBe('0.10.0')
    expect(release?.pageUrl).toBe(
      'https://github.com/teler-ai/teler-client/releases/tag/cli-v0.10.0'
    )
    expect(release?.assets.map((asset) => asset.name)).toEqual([
      'teler-linux-x64',
      'SHA256SUMS.txt',
    ])
    expect(new Headers(requests[0]?.init?.headers).get('user-agent')).toBe('test-agent')
  })

  test('keeps only downloads from the official releases', async () => {
    const listing = releaseListing([{ tag: 'cli-v0.2.0', assets: { 'teler-linux-x64': 1 } }])
    const [release] = listing
    release?.assets.push({
      name: 'teler-mac-arm64',
      browser_download_url: 'https://example.com/teler-mac-arm64',
      size: 1,
    })
    const result = await latestRelease('cli', { fetch: releaseServer(listing).fetch })
    expect(result?.assets.map((asset) => asset.name)).toEqual(['teler-linux-x64'])
  })

  test('reads further pages until one has a release of the product', async () => {
    const desktop = releaseListing(
      Array.from({ length: 100 }, (_, index) => ({ tag: `desktop-v0.0.${index}` }))
    )
    const requests: string[] = []
    const fetch = async (url: string) => {
      requests.push(url)
      return Response.json(
        url.endsWith('&page=1') ? desktop : releaseListing([{ tag: 'cli-v0.3.0' }])
      )
    }
    expect((await latestRelease('cli', { fetch }))?.version).toBe('0.3.0')
    expect(requests.map((url) => url.slice(url.indexOf('?')))).toEqual([
      '?per_page=100&page=1',
      '?per_page=100&page=2',
    ])
  })

  test('never offers a prerelease version or a page outside the official releases', async () => {
    const listing = releaseListing([
      { tag: 'cli-v0.5.0-rc.1' },
      { tag: 'cli-v0.4.0' },
      { tag: 'cli-v0.2.0' },
    ])
    const [, other] = listing
    if (other) other.html_url = 'https://example.com/teler-client/releases/tag/cli-v0.4.0'
    const release = await latestRelease('cli', { fetch: releaseServer(listing).fetch })
    expect(release?.version).toBe('0.2.0')
  })

  test('returns null without a release and throws when GitHub cannot be read', async () => {
    expect(await latestRelease('cli', { fetch: releaseServer([]).fetch })).toBeNull()
    const unavailable = async () => new Response('Not Found', { status: 404 })
    await expect(latestRelease('cli', { fetch: unavailable })).rejects.toThrow('HTTP 404')
  })
})
