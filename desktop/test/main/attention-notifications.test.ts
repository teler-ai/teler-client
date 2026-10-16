import type { EventEmitter } from 'node:events'
import type { Session, WebRequest } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopActivity, NotificationSettings } from '../../src/shared/desktop-api'
import { createTranslator } from '../../src/main/i18n'
import { composeNotification } from '../../src/main/notifications/compose'
import type { InboxEvent, NotificationTarget } from '../../src/main/notifications/types'

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

const t = createTranslator('en')
const SETTINGS: NotificationSettings = {
  files: true,
  folders: true,
  problems: true,
  chats: true,
  alerts: true,
  inbox: true,
  sound: true,
}
const webRequest: Partial<WebRequest> = { onCompleted: vi.fn() }
const partialSession: Partial<Session> = { webRequest: webRequest as WebRequest }
const session = partialSession as Session

const CHAT = 'chat_01m2k72d22fqe8ww472ycs3px3'

function attention(overrides: Record<string, unknown> = {}) {
  return {
    cursor: '2026-10-16T10:00:00.000Z',
    running: { chats: [], agentRuns: [] },
    waiting: { chats: [] },
    unreadNotifications: [{ organizationId: 'org_a', count: 0 }],
    finished: { chats: [], agentRuns: [] },
    notifications: [],
    ...overrides,
  }
}
const finishedChat = (taskId: string, title: string | null = 'Sales by region') => ({
  id: CHAT,
  title,
  organizationId: 'org_a',
  projectId: null,
  taskId,
  status: 'completed',
  completedAt: '2026-10-16T10:00:05.000Z',
})
const notice = (id: string, type = 'agent_completed', overrides: Record<string, unknown> = {}) => ({
  id,
  organizationId: 'org_a',
  type,
  title: 'Weekly pace',
  body: 'Three weeks are behind.',
  agentLabel: 'Weekly pace',
  createdAt: '2026-10-16T10:00:03.000Z',
  targetPath: '/agents',
  ...overrides,
})

function setup(
  responses: Array<Record<string, unknown> | Response>,
  options: {
    settings?: NotificationSettings
    onScreen?: (target: NotificationTarget) => boolean
  } = {}
) {
  const requests: string[] = []
  const activities: Array<DesktopActivity | null> = []
  const warnings: string[] = []
  const showTeler = vi.fn()
  const notifications = new DesktopNotifications({
    origin: 'https://app.test',
    authOrigin: 'https://auth.test',
    platform: 'linux',
    windowFetch: async (url) => {
      requests.push(url)
      if (url.includes('/api/alerts/feed')) return Response.json({ events: [], cursor: '1' })
      const next = responses.shift()
      if (next instanceof Response) return next
      return Response.json(next ?? attention({ cursor: '2026-10-16T10:09:00.000Z' }))
    },
    settings: () => options.settings ?? SETTINGS,
    translate: () => t,
    language: () => 'en',
    onScreen: options.onScreen ?? (() => false),
    showTeler,
    openSettings: vi.fn(),
    onActivity: (activity) => activities.push(activity),
    warn: (message) => warnings.push(message),
  })
  const attentionRequests = () => requests.filter((url) => url.includes('/api/attention'))
  return { notifications, requests, attentionRequests, activities, warnings, showTeler }
}

describe('inbox notification copy', () => {
  const inbox = (overrides: Partial<InboxEvent> = {}): InboxEvent => ({
    kind: 'inbox',
    id: 'notif_1',
    organizationId: 'org_a',
    type: 'agent_completed',
    title: 'Weekly pace',
    body: 'Three weeks are behind.',
    agentLabel: 'Weekly pace',
    targetPath: '/agents',
    ...overrides,
  })

  it('says what happened by the type of the notice and opens its page', () => {
    expect(composeNotification('inbox', [inbox()], t)).toEqual({
      kind: 'inbox',
      title: 'Weekly pace finished',
      body: 'Three weeks are behind.',
      target: { type: 'teler', path: '/agents', organizationId: 'org_a' },
    })
    expect(
      composeNotification(
        'inbox',
        [inbox({ type: 'schedule_stopped', title: 'Monday report', body: null })],
        t
      ).title
    ).toBe('The schedule of Monday report stopped')
    expect(
      composeNotification('inbox', [inbox({ type: 'access_requested', body: null })], t)
    ).toMatchObject({ title: 'Someone asked you for access', body: 'Weekly pace' })
  })

  it('keeps an unknown type as the server wrote it', () => {
    expect(
      composeNotification('inbox', [inbox({ type: 'brand_new', title: 'Something new' })], t)
    ).toMatchObject({ title: 'Something new', body: 'Three weeks are behind.' })
  })

  it('groups several notices and opens the latest', () => {
    const composed = composeNotification(
      'inbox',
      [
        inbox(),
        inbox({ id: 'notif_2', type: 'agent_failed', agentLabel: 'Stock watch' }),
        inbox({
          id: 'notif_3',
          type: 'access_requested',
          targetPath: '/home',
          organizationId: 'org_b',
        }),
      ],
      t
    )
    expect(composed).toEqual({
      kind: 'inbox',
      title: '3 notifications in Teler',
      body: 'Weekly pace finished, Stock watch failed and 1 more',
      target: { type: 'teler', path: '/home', organizationId: 'org_b' },
    })
  })
})

describe('attention notifications', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    shown.length = 0
  })
  afterEach(() => vi.useRealTimers())

  it('takes a baseline, then announces a turn that started and finished between two reads', async () => {
    const { notifications, attentionRequests, activities } = setup([
      attention(),
      attention({
        cursor: '2026-10-16T10:00:20.000Z',
        finished: { chats: [finishedChat('atask_1')], agentRuns: [] },
      }),
      attention({
        cursor: '2026-10-16T10:00:40.000Z',
        finished: { chats: [finishedChat('atask_1')], agentRuns: [] },
      }),
    ])
    notifications.start(session)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(attentionRequests()).toEqual(['https://app.test/api/attention'])
    expect(shown).toHaveLength(0)
    expect(activities).toEqual([
      {
        runningChats: 0,
        runningAgents: 0,
        waitingChats: 0,
        unreadNotifications: 0,
        runningChat: null,
        waitingChat: null,
      },
    ])

    // Idle: the next read comes 20 s later and names the previous cursor.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(attentionRequests()[1]).toBe(
      'https://app.test/api/attention?since=2026-10-16T10%3A00%3A00.000Z'
    )
    await vi.advanceTimersByTimeAsync(3_000)
    expect(shown).toHaveLength(1)
    expect(shown[0]?.options).toEqual({
      title: 'Teler finished',
      body: 'Sales by region',
      silent: false,
    })
    // The overlap repeats the finished turn: it is not announced again.
    await vi.advanceTimersByTimeAsync(23_000)
    expect(shown).toHaveLength(1)
    notifications.stop()
  })

  it('announces notices in Teler as their own kind, unless the switch is off', async () => {
    const reads = () => [
      attention(),
      attention({
        cursor: '2026-10-16T10:00:20.000Z',
        notifications: [notice('notif_1'), notice('notif_2', 'handoff_completed')],
      }),
    ]
    const on = setup(reads())
    on.notifications.start(session)
    await vi.advanceTimersByTimeAsync(33_000)
    expect(shown).toHaveLength(1)
    expect(shown[0]?.options).toMatchObject({ title: 'Weekly pace finished' })
    shown[0]?.emit('click')
    await vi.advanceTimersByTimeAsync(0)
    expect(on.showTeler).toHaveBeenCalledWith('/agents')
    on.notifications.stop()

    shown.length = 0
    const off = setup(reads(), { settings: { ...SETTINGS, inbox: false } })
    off.notifications.start(session)
    await vi.advanceTimersByTimeAsync(33_000)
    expect(shown).toHaveLength(0)
    off.notifications.stop()
  })

  it('stays quiet for the chat the person is looking at, and shows the rest', async () => {
    const { notifications } = setup(
      [
        attention(),
        attention({
          cursor: '2026-10-16T10:00:20.000Z',
          finished: { chats: [finishedChat('atask_1')], agentRuns: [] },
          notifications: [notice('notif_1')],
        }),
      ],
      { onScreen: (target) => target.type === 'teler' && target.path === `/chat/${CHAT}` }
    )
    notifications.start(session)
    await vi.advanceTimersByTimeAsync(33_000)
    expect(shown.map((item) => item.options.title)).toEqual(['Weekly pace finished'])
    notifications.stop()
  })

  it('reads fast while something runs and reports it to the tray', async () => {
    const { notifications, attentionRequests, activities } = setup([
      attention({
        running: {
          chats: [
            {
              id: CHAT,
              title: 'Sales by region',
              organizationId: 'org_a',
              projectId: null,
              taskId: 'atask_1',
              status: 'running',
              startedAt: null,
            },
          ],
          agentRuns: [],
        },
        waiting: { chats: [finishedChat('atask_0', null)] },
        unreadNotifications: [
          { organizationId: 'org_a', count: 2 },
          { organizationId: 'org_b', count: 1 },
        ],
      }),
    ])
    notifications.start(session)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(activities.at(-1)).toEqual({
      runningChats: 1,
      runningAgents: 0,
      waitingChats: 1,
      unreadNotifications: 3,
      runningChat: { id: CHAT, organizationId: 'org_a' },
      waitingChat: { id: CHAT, organizationId: 'org_a' },
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(attentionRequests()).toHaveLength(2)
    notifications.stop()
  })

  it('forgets the baseline when the window signs out, and reports no activity', async () => {
    const { notifications, attentionRequests, activities } = setup([
      attention(),
      new Response('{}', { status: 401 }),
      attention({ cursor: '2026-10-16T10:01:00.000Z' }),
    ])
    notifications.start(session)
    await vi.advanceTimersByTimeAsync(10_000 + 20_000 + 20_000)
    expect(attentionRequests()).toEqual([
      'https://app.test/api/attention',
      'https://app.test/api/attention?since=2026-10-16T10%3A00%3A00.000Z',
      'https://app.test/api/attention',
    ])
    expect(activities[1]).toBeNull()
    notifications.stop()
  })

  it('reports a notification the system refused to show', async () => {
    const { notifications, warnings } = setup([
      attention(),
      attention({
        cursor: '2026-10-16T10:00:20.000Z',
        finished: { chats: [finishedChat('atask_1')], agentRuns: [] },
      }),
    ])
    notifications.start(session)
    await vi.advanceTimersByTimeAsync(33_000)
    shown[0]?.emit('failed', {}, 'denied by the system')
    expect(warnings).toEqual(['A desktop notification could not be shown: denied by the system'])
    notifications.stop()
  })
})
