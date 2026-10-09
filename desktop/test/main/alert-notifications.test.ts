import { describe, expect, it } from 'vitest'
import { alertFeedSchema, type AlertFeedEvent } from '../../src/main/notifications/alert-events'
import { composeNotification } from '../../src/main/notifications/compose'
import { createTranslator } from '../../src/main/i18n'

const t = createTranslator('en')

function alert(overrides: Partial<AlertFeedEvent> = {}): AlertFeedEvent {
  return {
    seq: '1',
    kind: 'opened',
    alertId: 'alert_1',
    organizationId: 'org_1',
    agentLabel: 'Weekly sales check',
    isOwner: true,
    ownerName: null,
    title: 'North is 18% below last year',
    targetPath: '/agents/agent_1?alert=alert_1',
    openedAt: '2026-10-05T12:00:00.000Z',
    occurredAt: '2026-10-07T12:00:00.000Z',
    ...overrides,
  }
}

describe('alert notification copy and targets', () => {
  it('names the Agent that alerted you, with the alert title, and opens the alert', () => {
    expect(composeNotification('alerts', [alert()], t)).toEqual({
      kind: 'alerts',
      title: 'Weekly sales check alerted you',
      body: 'North is 18% below last year',
      target: { type: 'teler', path: '/agents/agent_1?alert=alert_1', organizationId: 'org_1' },
    })
  })

  it("names the owner of a colleague's Agent", () => {
    const composed = composeNotification('alerts', [alert({ isOwner: false, ownerName: 'Ana' })], t)
    expect(composed.title).toBe('Weekly sales check (Ana’s) alerted you')
    expect(composed.body).toBe('North is 18% below last year')
  })

  it('says an Agent is back to normal and the day it had alerted you, not the day it closed', () => {
    expect(composeNotification('alerts', [alert({ kind: 'back_to_normal' })], t)).toMatchObject({
      title: 'Weekly sales check is back to normal',
      body: 'It alerted you on Monday: North is 18% below last year',
    })
  })

  it('writes the weekday in the language of the app', () => {
    const composed = composeNotification(
      'alerts',
      [alert({ kind: 'back_to_normal' })],
      createTranslator('es'),
      'es'
    )
    expect(composed.body).toContain('lunes')
  })

  it('groups several alerts and opens the latest', () => {
    const composed = composeNotification(
      'alerts',
      [
        alert({ seq: '1' }),
        alert({ seq: '2', alertId: 'alert_2', agentLabel: 'Stock alerts' }),
        alert({
          seq: '3',
          alertId: 'alert_3',
          agentLabel: 'Churn watch',
          organizationId: 'org_2',
          targetPath: '/agents/agent_3?alert=alert_3',
        }),
      ],
      t
    )
    expect(composed).toEqual({
      kind: 'alerts',
      title: '3 Agent alerts',
      body: 'Weekly sales check, Stock alerts and 1 more',
      target: { type: 'teler', path: '/agents/agent_3?alert=alert_3', organizationId: 'org_2' },
    })
  })

  it('groups two alerts without a count of the rest', () => {
    const composed = composeNotification(
      'alerts',
      [alert(), alert({ seq: '2', alertId: 'alert_2', agentLabel: 'Stock alerts' })],
      t
    )
    expect(composed).toMatchObject({
      title: '2 Agent alerts',
      body: 'Weekly sales check and Stock alerts',
    })
  })
})

describe('alert feed schema', () => {
  it('accepts the feed response', () => {
    const feed = { events: [alert()], cursor: '42' }
    expect(alertFeedSchema.parse(feed)).toEqual(feed)
  })

  it.each(['https://evil.test/', '//evil.test/', 'agents/1'])(
    'refuses a target that is not a Teler path (%s)',
    (targetPath) => {
      expect(
        alertFeedSchema.safeParse({ events: [alert({ targetPath })], cursor: '1' }).success
      ).toBe(false)
    }
  )

  it('refuses an event of an unknown kind', () => {
    const events = [{ ...alert(), kind: 'repeated' }]
    expect(alertFeedSchema.safeParse({ events, cursor: '1' }).success).toBe(false)
  })
})
