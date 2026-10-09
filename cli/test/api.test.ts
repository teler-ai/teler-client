import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { TelerApiClient } from '../src/api'

describe('TelerApiClient', () => {
  it('uses bearer auth and refuses redirects', async () => {
    let seen: RequestInit | undefined
    const client = new TelerApiClient(
      new URL('https://app.teler.ai'),
      'secret-token',
      async (_, init) => {
        seen = init
        return new Response(null, { status: 302, headers: { location: 'https://evil.test' } })
      }
    )
    await expect(client.request('/api/chat')).rejects.toThrow('authentication redirect')
    expect(new Headers(seen?.headers).get('authorization')).toBe('Bearer secret-token')
    expect(seen?.redirect).toBe('manual')
  })

  it('names itself and its version to Teler', async () => {
    let seen: RequestInit | undefined
    const client = new TelerApiClient(new URL('https://app.teler.ai'), 'token', async (_, init) => {
      seen = init
      return Response.json({})
    })
    await client.request('/api/chat')
    const { version } = (await Bun.file(new URL('../package.json', import.meta.url)).json()) as {
      version: string
    }
    expect(new Headers(seen?.headers).get('teler-client')).toBe(`teler-cli/${version}`)
  })

  it('tells the user to update when Teler no longer supports this version', async () => {
    const refuse = (body: unknown) =>
      new TelerApiClient(new URL('https://app.teler.ai'), 'token', async () =>
        Response.json(body, { status: 426 })
      )
    const outdated = refuse({ code: 'CLIENT_UPDATE_REQUIRED', minVersion: '0.2.0' })
    await expect(outdated.request('/api/chat')).rejects.toMatchObject({
      status: 426,
      code: 'CLIENT_UPDATE_REQUIRED',
      message: expect.stringContaining('Update the teler CLI to 0.2.0 or later'),
    })
    // A version that is not a plain version number is never echoed.
    const odd = refuse({ code: 'CLIENT_UPDATE_REQUIRED', minVersion: '<script>' })
    const error = await odd.request('/api/chat').catch((caught: unknown) => caught)
    expect(String((error as Error).message)).not.toContain('<script>')
    expect(String((error as Error).message)).toContain('Update the teler CLI')
  })

  it('validates JSON response contracts', async () => {
    const client = new TelerApiClient(new URL('https://app.teler.ai'), undefined, async () =>
      Response.json({ ok: true })
    )
    expect(await client.json('/x', z.object({ ok: z.literal(true) }))).toEqual({ ok: true })
  })

  it('preserves bounded retry metadata without exposing response text', async () => {
    const client = new TelerApiClient(new URL('https://app.teler.ai'), 'secret', async () =>
      Response.json(
        { code: 'PART_BUSY', error: 'provider detail' },
        { status: 409, headers: { 'Retry-After': '2' } }
      )
    )

    await expect(client.request('/api/uploads/fpjob_test/parts/1')).rejects.toMatchObject({
      status: 409,
      code: 'PART_BUSY',
      retryAfterMs: 2_000,
      message: 'Teler API request failed (409 PART_BUSY)',
    })
  })

  it('rejects absolute and protocol-relative paths before sending credentials', async () => {
    let called = false
    const client = new TelerApiClient(new URL('https://app.teler.ai'), 'secret-token', async () => {
      called = true
      return Response.json({})
    })

    await expect(client.request('//evil.example/api')).rejects.toThrow('configured origin')
    await expect(client.request('https://evil.example/api')).rejects.toThrow('configured origin')
    await expect(client.request('/\\evil.example/api')).rejects.toThrow('configured origin')
    expect(called).toBe(false)
  })

  it('hides transport errors containing credentials and query values', async () => {
    const client = new TelerApiClient(new URL('https://app.teler.ai'), 'secret-token', async () => {
      throw new Error(
        'Bearer secret-token https://private/db?password=private-value member@example.com'
      )
    })
    await expect(client.request('/api/schedule?organizationId=org_private')).rejects.toThrow(
      'Teler API request could not be completed'
    )
  })

  it('hides invalid JSON parser details from successful responses', async () => {
    const client = new TelerApiClient(
      new URL('https://app.teler.ai'),
      'secret-token',
      async () => new Response('Bearer secret-token https://private/db?password=private-value')
    )
    await expect(
      client.json('/api/schedule', z.object({ schedules: z.array(z.unknown()) }))
    ).rejects.toThrow('Teler API returned an invalid response')
  })
})
