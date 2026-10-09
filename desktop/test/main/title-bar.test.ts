import { describe, expect, it } from 'vitest'
import type { DesktopState, SyncedFolder } from '../../src/shared/desktop-api'
import {
  frameOptions,
  isTitleBarUrl,
  titleBarInsets,
  titleBarState,
  viewBounds,
} from '../../src/main/title-bar'

const surface = { background: '#faf8f5', foreground: '#222222' }

describe('app top bar frame', () => {
  it('insets the macOS traffic lights into the bar', () => {
    expect(frameOptions('darwin', surface)).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 13 },
    })
  })

  it('draws themed window controls over the bar on Windows and Linux', () => {
    for (const platform of ['win32', 'linux'] as const)
      expect(frameOptions(platform, surface)).toEqual({
        titleBarStyle: 'hidden',
        // One pixel short, so the bar's bottom border runs under the controls.
        titleBarOverlay: { color: '#faf8f5', symbolColor: '#222222', height: 39 },
      })
  })

  it('keeps the window controls clear', () => {
    expect(titleBarInsets('darwin', false)).toEqual({ left: 80, right: 12 })
    // Full screen hides the traffic lights.
    expect(titleBarInsets('darwin', true)).toEqual({ left: 12, right: 12 })
    expect(titleBarInsets('win32', false)).toEqual({ left: 8, right: 140 })
    expect(titleBarInsets('linux', true)).toEqual({ left: 8, right: 140 })
  })

  it('stacks the bar above the Teler page', () => {
    expect(viewBounds(1280, 860)).toEqual({
      bar: { x: 0, y: 0, width: 1280, height: 40 },
      content: { x: 0, y: 40, width: 1280, height: 820 },
    })
    expect(viewBounds(300, 20).content.height).toBe(0)
  })

  it('accepts only the bundled bar page as the bar', () => {
    expect(isTitleBarUrl('teler-desktop://app/title-bar.html')).toBe(true)
    expect(isTitleBarUrl('teler-desktop://app/index.html')).toBe(false)
    expect(isTitleBarUrl('https://app.teler.ai/title-bar.html')).toBe(false)
    expect(isTitleBarUrl(undefined)).toBe(false)
  })
})

describe('app top bar state', () => {
  const folder = (pending: number): SyncedFolder => ({
    id: String(pending),
    localPath: '/x',
    name: 'x',
    destination: '/personal/x',
    status: 'pending',
    counts: { synced: 0, pending, waiting: 0, problems: 0, skipped: 0 },
    problemFiles: [],
    waitingFiles: [],
    nextRetryAt: null,
    organizationId: 'org_1',
    projectId: null,
    projectName: null,
    checkedAt: null,
  })
  const desktop = {
    platform: 'win32',
    health: 'syncing',
    folders: [folder(2), folder(3)],
    preferences: { language: 'ca', themeVariant: 'dali', colorMode: 'dark' },
  } as const satisfies Pick<DesktopState, 'platform' | 'health' | 'folders' | 'preferences'>

  it('combines navigation with sync status and preferences', () => {
    expect(
      titleBarState(desktop, { canGoBack: true, canGoForward: false, loading: true }, false)
    ).toEqual({
      platform: 'win32',
      view: 'teler',
      insets: { left: 8, right: 140 },
      showMenuButton: true,
      canGoBack: true,
      canGoForward: false,
      loading: true,
      health: 'syncing',
      pendingFiles: 5,
      preferences: desktop.preferences,
    })
  })

  it('leaves the menu to the macOS menu bar', () => {
    const state = titleBarState(
      { ...desktop, platform: 'darwin' },
      { canGoBack: false, canGoForward: false, loading: false },
      true
    )
    expect(state.showMenuButton).toBe(false)
    expect(state.insets).toEqual({ left: 12, right: 12 })
    expect(state.view).toBe('teler')
    const onSync = titleBarState(
      desktop,
      { canGoBack: true, canGoForward: false, loading: false },
      false,
      'sync'
    )
    expect(onSync.view).toBe('sync')
  })
})
