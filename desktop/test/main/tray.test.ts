import { describe, expect, it } from 'vitest'
import type { SyncedFolder } from '../../src/shared/desktop-api'
import { createTranslator, MAIN_CATALOGS } from '../../src/main/i18n'
import {
  badgeToneFor,
  drawBadge,
  drawTemplateMark,
  templateMarkFor,
  toTemplate,
} from '../../src/main/tray-icon'
import { buildTrayMenu, trayTooltip, type TrayState } from '../../src/main/tray-menu'

const t = createTranslator('en')
const folder = (pending: number, waiting = 0): SyncedFolder => ({
  id: 'f',
  localPath: '/x',
  name: 'x',
  destination: '/personal/x',
  status: pending || waiting ? 'pending' : 'ready',
  counts: { synced: 1, pending, waiting, problems: 0, skipped: 0 },
  problemFiles: [],
  waitingFiles: [],
  nextRetryAt: null,
  organizationId: 'org_1',
  projectId: null,
  projectName: null,
  checkedAt: null,
})

function state(overrides: Partial<TrayState> = {}): TrayState {
  return {
    health: 'up-to-date',
    connection: {
      status: 'connected',
      account: { id: 'u', name: 'Ana' },
      error: null,
    },
    syncPaused: false,
    openAtLogin: true,
    openAtLoginAvailable: true,
    folders: [folder(0)],
    organizations: [
      { id: 'org_1', name: 'Acme' },
      { id: 'org_2', name: 'Beta' },
    ],
    activeOrganizationId: 'org_1',
    ...overrides,
  }
}

const actions = (items: ReturnType<typeof buildTrayMenu>) =>
  items.flatMap((item) => ('action' in item ? [item.action] : []))
const labels = (items: ReturnType<typeof buildTrayMenu>) =>
  items.flatMap((item) => ('label' in item ? [item.label] : []))

describe('tray menu', () => {
  it('opens Synced folders from the status line and Teler from the account line', () => {
    const items = buildTrayMenu(state({ health: 'syncing', folders: [folder(2), folder(1, 2)] }), t)
    expect(items.slice(0, 2)).toEqual([
      { type: 'action', action: 'open-settings', label: 'Syncing (5 pending)' },
      { type: 'action', action: 'open-teler', label: 'Ana · Acme' },
    ])
    // The status and account lines replace "Synced folders…" and "Open Teler".
    expect(actions(items)).toEqual([
      'open-settings',
      'open-teler',
      'sync-folder',
      'pause-sync',
      'toggle-open-at-login',
      'quit',
    ])
    expect(items).toContainEqual({
      type: 'checkbox',
      action: 'toggle-open-at-login',
      label: 'Open at login',
      checked: true,
    })
  })

  it('has no disabled lines', () => {
    for (const health of ['up-to-date', 'attention', 'not-connected', 'sign-in-required'] as const)
      for (const item of buildTrayMenu(state({ health }), t))
        expect(item.type === 'separator' || 'action' in item).toBe(true)
  })

  it('names the organization open in Teler, when known', () => {
    expect(labels(buildTrayMenu(state({ activeOrganizationId: 'org_2' }), t))[1]).toBe('Ana · Beta')
    expect(labels(buildTrayMenu(state({ activeOrganizationId: null }), t))[1]).toBe('Ana')
    const unnamed = state({
      connection: { status: 'connected', account: { id: 'u', name: null }, error: null },
    })
    expect(labels(buildTrayMenu(unnamed, t))[1]).toBe('Open Teler')
  })

  it('leaves out open at login where it is unavailable (development builds)', () => {
    expect(actions(buildTrayMenu(state({ openAtLoginAvailable: false }), t))).not.toContain(
      'toggle-open-at-login'
    )
  })

  it('connects or reconnects from the status line, and resumes when paused', () => {
    const disconnected = buildTrayMenu(
      state({
        health: 'not-connected',
        connection: { status: 'disconnected', account: null, error: null },
      }),
      t
    )
    expect(disconnected.slice(0, 2)).toEqual([
      { type: 'action', action: 'connect', label: 'Connect folder sync…' },
      { type: 'action', action: 'open-teler', label: 'Open Teler' },
    ])
    expect(actions(disconnected)).not.toContain('pause-sync')
    expect(buildTrayMenu(state({ health: 'sign-in-required' }), t)[0]).toEqual({
      type: 'action',
      action: 'connect',
      label: 'Reconnect folder sync…',
    })
    expect(actions(buildTrayMenu(state({ health: 'paused', syncPaused: true }), t))).toContain(
      'resume-sync'
    )
    expect(actions(buildTrayMenu(state({ health: 'no-folders', folders: [] }), t))).not.toContain(
      'pause-sync'
    )
  })

  it('offers a newer Teler release above the app settings', () => {
    expect(actions(buildTrayMenu(state(), t))).not.toContain('install-update')
    const items = buildTrayMenu(state({ update: { version: '0.3.0' } }), t)
    const index = items.findIndex((item) => 'action' in item && item.action === 'install-update')
    expect(items[index]).toEqual({
      type: 'action',
      action: 'install-update',
      label: 'Update to Teler 0.3.0…',
    })
    expect(items[index - 1]).toEqual({ type: 'separator' })
    expect(actions(items).slice(-3)).toEqual(['install-update', 'toggle-open-at-login', 'quit'])
  })

  it('builds a tooltip', () => {
    expect(trayTooltip(state(), t)).toBe('Teler — Up to date')
  })
})

describe('tray icon', () => {
  it('maps health to a badge tone', () => {
    expect(badgeToneFor('up-to-date')).toBeNull()
    expect(badgeToneFor('syncing')).toBe('active')
    expect(badgeToneFor('sign-in-required')).toBe('error')
    expect(badgeToneFor('offline')).toBe('warning')
    expect(badgeToneFor('paused')).toBe('muted')
  })

  it('draws an opaque dot in the corner and keeps the rest of the icon', () => {
    const size = 16
    const icon = new Uint8Array(size * size * 4).fill(200)
    const badged = drawBadge(icon, size, size, 'error')
    const pixel = (x: number, y: number) =>
      Array.from(badged.slice((y * size + x) * 4, (y * size + x) * 4 + 4))
    expect(pixel(12, 12)).toEqual([38, 38, 220, 255])
    expect(pixel(1, 1)).toEqual([200, 200, 200, 200])
    expect(icon[0]).toBe(200)
  })

  it('turns the icon into a black template that keeps its alpha', () => {
    expect(Array.from(toTemplate(Uint8Array.from([10, 20, 30, 128])))).toEqual([0, 0, 0, 128])
  })

  it('shows macOS template states through shape and opacity only', () => {
    expect(templateMarkFor(null)).toBe('none')
    expect(templateMarkFor('active')).toBe('ring')
    expect(templateMarkFor('muted')).toBe('dim')
    expect(templateMarkFor('warning')).toBe('dot')
    expect(templateMarkFor('error')).toBe('dot')

    const size = 16
    const icon = toTemplate(new Uint8Array(size * size * 4).fill(200))
    const pixel = (bitmap: Uint8Array, x: number, y: number) =>
      Array.from(bitmap.slice((y * size + x) * 4, (y * size + x) * 4 + 4))
    // Every mark stays black, so the menu bar can tint it white or black.
    for (const mark of ['ring', 'dot', 'dim'] as const) {
      const colours = drawTemplateMark(icon, size, size, mark).filter((_, index) => index % 4 !== 3)
      expect(colours.every((value) => value === 0)).toBe(true)
    }
    expect(pixel(drawTemplateMark(icon, size, size, 'dot'), 12, 12)).toEqual([0, 0, 0, 255])
    // The ring is hollow: its centre is cut out, unlike the dot.
    expect(pixel(drawTemplateMark(icon, size, size, 'ring'), 12, 12)).toEqual([0, 0, 0, 0])
    expect(pixel(drawTemplateMark(icon, size, size, 'dim'), 1, 1)).toEqual([0, 0, 0, 90])
    expect(drawTemplateMark(icon, size, size, 'none')).toEqual(icon)
  })
})

describe('main-process locales', () => {
  it('translate every key in every supported language', () => {
    const english = Object.keys(MAIN_CATALOGS.en).sort()
    for (const [language, catalog] of Object.entries(MAIN_CATALOGS)) {
      expect(Object.keys(catalog).sort(), language).toEqual(english)
      for (const [key, value] of Object.entries(catalog))
        expect(value.trim(), `${language}:${key}`).not.toBe('')
    }
  })

  it('interpolates values', () => {
    expect(
      createTranslator('ca')('tray.accountWithOrganization', {
        name: 'Núria',
        organization: 'Acme',
      })
    ).toBe('Núria · Acme')
  })
})
