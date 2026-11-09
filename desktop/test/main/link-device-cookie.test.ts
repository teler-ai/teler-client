import { describe, expect, it } from 'vitest'
import { LINK_DEVICE_COOKIE, syncLinkDeviceCookie } from '../../src/main/link-device-cookie'

function jar() {
  const calls: Array<[string, string, string?]> = []
  return {
    calls,
    set: async (details: { url: string; name: string; value: string }) => {
      calls.push(['set', details.url, details.value])
    },
    remove: async (url: string, name: string) => {
      calls.push(['remove', url, name])
    },
  }
}

describe('the Teler Link computer cookie', () => {
  it('marks the paired computer on the Teler and sign-in origins, once each', async () => {
    const cookies = jar()
    await syncLinkDeviceCookie(
      cookies,
      ['https://app.teler.ai', 'https://app.teler.ai'],
      'lnkdev_01m6g8ej70ehy8e0s6syttrx91'
    )
    expect(cookies.calls).toEqual([
      ['set', 'https://app.teler.ai/', 'lnkdev_01m6g8ej70ehy8e0s6syttrx91'],
    ])
  })

  it('removes it without a pairing, and never writes anything that is not a device id', async () => {
    const cookies = jar()
    await syncLinkDeviceCookie(cookies, ['https://a.example', 'https://b.example'], null)
    await syncLinkDeviceCookie(cookies, ['https://a.example'], 'tlk_not-an-id')
    expect(cookies.calls).toEqual([
      ['remove', 'https://a.example/', LINK_DEVICE_COOKIE],
      ['remove', 'https://b.example/', LINK_DEVICE_COOKIE],
      ['remove', 'https://a.example/', LINK_DEVICE_COOKIE],
    ])
  })
})
