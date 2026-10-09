import type { EventEmitter } from 'node:events'
import type { Session, WebRequest } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationSettings } from '../../src/shared/desktop-api'

const shown: Array<EventEmitter & { options: { title: string; body: string } }> = []
vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class Notification extends Emitter {
    static isSupported = () => true
    constructor(readonly options: { title: string; body: string; silent: boolean }) {
      super()
    }
    show() {
      shown.push(this)
    }
    close() {
      this.emit('close')
    }
  }
  return { Notification }
})

const { DesktopNotifications } = await import('../../src/main/notifications/desktop-notifications')

const SETTINGS = {
  files: true,
  folders: true,
  problems: true,
  chats: true,
  alerts: true,
  sound: true,
}

function setup(
  settings: NotificationSettings = SETTINGS,
  feed: (url: string) => Response = () => Response.json({ success: true })
) {
  const requests: Array<{ url: string; body: unknown }> = []
  const showTeler = vi.fn()
  const notifications = new DesktopNotifications({
    origin: 'https://app.test',
    authOrigin: 'https://auth.test',
    platform: 'linux',
    windowFetch: async (url, init) => {
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return feed(url)
    },
    settings: () => settings,
    translate: () => (key) => key,
    language: () => 'en',
    isForeground: () => false,
    showTeler,
    openSettings: vi.fn(),
  })
  return { notifications, requests, showTeler }
}

const registration = (hash: string) => [
  {
    id: 'reg',
    localPath: '/Users/ana/Reports',
    organizationId: 'org_a',
    files: [{ relativePath: 'a.csv', status: 'ready', hash }],
  },
]

describe('desktop notifications', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    shown.length = 0
  })
  afterEach(() => vi.useRealTimers())

  it('a click always switches to the source organization before opening it', async () => {
    // The app's idea of the open organization can lag behind a switch made in
    // the web page, so the click never relies on it.
    const { notifications, requests, showTeler } = setup()
    notifications.syncChanged(registration('h1'))
    notifications.syncChanged(registration('h2'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(shown).toHaveLength(1)
    shown[0]?.emit('click')
    await vi.advanceTimersByTimeAsync(0)
    expect(requests).toEqual([
      { url: 'https://auth.test/api/user/active-organization', body: { organizationId: 'org_a' } },
    ])
    expect(showTeler).toHaveBeenCalledWith('/data')
    notifications.stop()
  })

  describe('Agent alerts', () => {
    const webRequest: Partial<WebRequest> = { onCompleted: vi.fn() }
    const partial: Partial<Session> = { webRequest: webRequest as WebRequest }
    const session = partial as Session
    const event = {
      seq: '8',
      kind: 'opened',
      alertId: 'alert_1',
      organizationId: 'org_a',
      agentLabel: 'Weekly sales check',
      isOwner: true,
      ownerName: null,
      title: 'North is 18% below last year',
      targetPath: '/agents/agent_1?alert=alert_1',
      openedAt: '2026-10-05T12:00:00.000Z',
      occurredAt: '2026-10-05T12:00:00.000Z',
    }
    const feedRequests = (requests: Array<{ url: string }>) =>
      requests.map((request) => request.url).filter((url) => url.includes('/api/alerts/feed'))

    it('takes a baseline first and announces only what comes after it', async () => {
      const responses = [
        // The baseline: alerts that already existed are never announced.
        { events: [{ ...event, seq: '3' }], cursor: '5' },
        { events: [event], cursor: '8' },
        { events: [], cursor: '8' },
      ]
      const { notifications, requests, showTeler } = setup(SETTINGS, (url) =>
        url.includes('/api/alerts/feed') ? Response.json(responses.shift()) : Response.json({})
      )
      notifications.start(session)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(feedRequests(requests)).toEqual(['https://app.test/api/alerts/feed'])
      await vi.advanceTimersByTimeAsync(10_000)
      expect(shown).toHaveLength(0)

      await vi.advanceTimersByTimeAsync(50_000)
      expect(feedRequests(requests)).toEqual([
        'https://app.test/api/alerts/feed',
        'https://app.test/api/alerts/feed?after=5',
      ])
      // The grouping window of the kind passes, then the alert is announced.
      await vi.advanceTimersByTimeAsync(3_000)
      expect(shown).toHaveLength(1)
      expect(shown[0]?.options).toMatchObject({
        title: 'notification.alerts.opened',
        body: 'North is 18% below last year',
      })

      await vi.advanceTimersByTimeAsync(60_000)
      expect(feedRequests(requests).at(-1)).toBe('https://app.test/api/alerts/feed?after=8')
      expect(shown).toHaveLength(1)

      shown[0]?.emit('click')
      await vi.advanceTimersByTimeAsync(0)
      expect(showTeler).toHaveBeenCalledWith('/agents/agent_1?alert=alert_1')
      expect(requests.at(-1)).toEqual({
        url: 'https://auth.test/api/user/active-organization',
        body: { organizationId: 'org_a' },
      })
      notifications.stop()
    })

    it('takes a fresh baseline at every start', async () => {
      const feed = (url: string) =>
        url.includes('/api/alerts/feed')
          ? Response.json({ events: [event], cursor: url.includes('after=') ? '9' : '8' })
          : Response.json({})
      for (let run = 0; run < 2; run += 1) {
        const { notifications, requests } = setup(SETTINGS, feed)
        notifications.start(session)
        await vi.advanceTimersByTimeAsync(10_000)
        expect(feedRequests(requests)).toEqual(['https://app.test/api/alerts/feed'])
        notifications.stop()
      }
      expect(shown).toHaveLength(0)
    })

    it('does not read the feed while the switch is off', async () => {
      const { notifications, requests } = setup({ ...SETTINGS, alerts: false })
      notifications.start(session)
      await vi.advanceTimersByTimeAsync(130_000)
      expect(feedRequests(requests)).toEqual([])
      notifications.stop()
    })

    it('takes a new baseline after the window signs out', async () => {
      let signedOut = false
      const { notifications, requests } = setup(SETTINGS, (url) => {
        if (!url.includes('/api/alerts/feed')) return Response.json({})
        return signedOut
          ? new Response('{}', { status: 401 })
          : Response.json({ events: [], cursor: '5' })
      })
      notifications.start(session)
      await vi.advanceTimersByTimeAsync(10_000)
      signedOut = true
      await vi.advanceTimersByTimeAsync(60_000)
      signedOut = false
      await vi.advanceTimersByTimeAsync(60_000)
      expect(feedRequests(requests)).toEqual([
        'https://app.test/api/alerts/feed',
        'https://app.test/api/alerts/feed?after=5',
        'https://app.test/api/alerts/feed',
      ])
      notifications.stop()
    })
  })
})
