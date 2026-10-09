import { expect, test } from 'bun:test'
import { withAccessToken } from '../src/access-token'
import { main } from '../src/index'

const origin = 'https://app.teler.example'

test('sends the Cloudflare Access token with every request to the configured origin', async () => {
  const seen: Array<{ url: string; access: string | null; bearer: string | null }> = []
  const fetch = async (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    seen.push({
      url: input,
      access: headers.get('cf-access-token'),
      bearer: headers.get('authorization'),
    })
    return Response.json({ user: { id: 'user_1', name: 'Ana' }, activeOrganizationId: 'org_1' })
  }
  const env = { TELER_URL: origin, TELER_TOKEN: 'cli-token', TELER_ACCESS_TOKEN: ' access-jwt ' }
  const output: string[] = []
  const writeOut = (text: string) => void output.push(text)
  expect(await main(['auth', 'status', '--json'], { env, fetch, writeOut })).toBe(0)
  expect(seen).toEqual([
    { url: `${origin}/api/teler-cli/me`, access: 'access-jwt', bearer: 'Bearer cli-token' },
  ])
})

test('never sends the Access token to another origin', async () => {
  const seen: Array<string | null> = []
  const fetch = withAccessToken(
    { TELER_URL: origin, TELER_ACCESS_TOKEN: 'access-jwt' },
    async (_input, init) => {
      seen.push(new Headers(init?.headers).get('cf-access-token'))
      return new Response(null, { status: 204 })
    }
  )
  await fetch?.('https://app.teler.ai/api/teler-cli/me')
  await fetch?.(`${origin}.evil.example/api/teler-cli/me`)
  await fetch?.(`${origin}/api/teler-cli/me`, { headers: { 'cf-access-token': 'forged' } })
  expect(seen).toEqual([null, null, 'access-jwt'])
})

test('leaves requests unchanged without an Access token', () => {
  const fetch = async () => new Response(null, { status: 204 })
  expect(withAccessToken({ TELER_URL: origin }, fetch)).toBe(fetch)
  expect(withAccessToken({ TELER_URL: origin, TELER_ACCESS_TOKEN: '  ' }, undefined)).toBe(
    undefined
  )
})
