/**
 * Tells the Teler pages in the window which Link computer this is: while this app holds a Teler
 * Link pairing, a `teler_link_device` cookie carries the paired computer's id (never its secret)
 * on the Teler origin and the sign-in origin, so Agent controls can mark it "This computer" and
 * run the member's chats here without pairing again. It is removed with the pairing.
 */

export const LINK_DEVICE_COOKIE = 'teler_link_device'
const DEVICE_ID = /^lnkdev_[0-9a-z]{26}$/

/** The part of Electron's `Cookies` this needs. */
export interface CookieJar {
  set(details: {
    url: string
    name: string
    value: string
    path: string
    sameSite: 'lax'
    secure?: boolean
  }): Promise<void>
  remove(url: string, name: string): Promise<void>
}

export async function syncLinkDeviceCookie(
  cookies: CookieJar,
  origins: readonly string[],
  deviceId: string | null
): Promise<void> {
  for (const origin of new Set(origins)) {
    const url = `${origin}/`
    if (deviceId && DEVICE_ID.test(deviceId)) {
      await cookies.set({
        url,
        name: LINK_DEVICE_COOKIE,
        value: deviceId,
        path: '/',
        sameSite: 'lax',
        ...(url.startsWith('https:') ? { secure: true } : {}),
      })
    } else {
      await cookies.remove(url, LINK_DEVICE_COOKIE)
    }
  }
}
