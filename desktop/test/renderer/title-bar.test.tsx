// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import i18n from '../../src/renderer/i18n'
import { TitleBar } from '../../src/renderer/title-bar/title-bar'
import type { SyncHealth } from '../../src/shared/desktop-api'
import type { TitleBarApi, TitleBarState } from '../../src/shared/title-bar-api'

type FakeTitleBarApi = { [K in keyof TitleBarApi]: Mock<TitleBarApi[K]> } & {
  emit: (state: TitleBarState) => void
}

function makeState(overrides: Partial<TitleBarState> = {}): TitleBarState {
  return {
    platform: 'darwin',
    view: 'teler',
    insets: { left: 78, right: 0 },
    showMenuButton: false,
    canGoBack: false,
    canGoForward: false,
    loading: false,
    health: 'up-to-date',
    pendingFiles: 0,
    preferences: { language: 'en', themeVariant: 'default', colorMode: 'light' },
    ...overrides,
  }
}

function createFakeApi(initial: TitleBarState | Error): FakeTitleBarApi {
  const listeners = new Set<(state: TitleBarState) => void>()
  return {
    emit: (state) => listeners.forEach((listener) => listener(state)),
    getState: vi.fn<TitleBarApi['getState']>(async () => {
      if (initial instanceof Error) throw initial
      return initial
    }),
    onStateChanged: vi.fn<TitleBarApi['onStateChanged']>((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    back: vi.fn<TitleBarApi['back']>(async () => undefined),
    forward: vi.fn<TitleBarApi['forward']>(async () => undefined),
    reload: vi.fn<TitleBarApi['reload']>(async () => undefined),
    openSettings: vi.fn<TitleBarApi['openSettings']>(async () => undefined),
    openMenu: vi.fn<TitleBarApi['openMenu']>(async () => undefined),
  }
}

async function renderBar(state: TitleBarState = makeState()) {
  await i18n.changeLanguage('en')
  const api = createFakeApi(state)
  const user = userEvent.setup()
  render(<TitleBar api={api} />)
  // Controls appear with the first state, in whatever language it carries.
  await screen.findAllByRole('button')
  return { api, user }
}

const root = document.documentElement

afterEach(() => {
  root.className = ''
  root.removeAttribute('lang')
  root.style.colorScheme = ''
})

describe('title bar layout', () => {
  it('keeps the window controls clear and moves the window from the bar only', async () => {
    await renderBar(makeState({ insets: { left: 78, right: 12 } }))
    const bar = screen.getByTestId('title-bar')
    expect(bar).toHaveStyle({ paddingLeft: '78px', paddingRight: '12px' })
    expect(bar).toHaveClass('app-region-drag', 'select-none')
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('app-region-no-drag')
    }
    // No context menu over the bar.
    expect(fireEvent.contextMenu(bar)).toBe(false)
  })

  it('stays an empty draggable bar until a state arrives', async () => {
    await i18n.changeLanguage('en')
    const api = createFakeApi(new Error('not ready'))
    render(<TitleBar api={api} />)
    await waitFor(() => expect(api.getState).toHaveBeenCalled())
    expect(screen.getByTestId('title-bar')).toHaveClass('app-region-drag')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    act(() => api.emit(makeState()))
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeEnabled()
  })
})

describe('navigation', () => {
  it('disables back and forward when there is no history', async () => {
    const { api, user } = await renderBar(makeState({ canGoBack: false, canGoForward: false }))
    const back = screen.getByRole('button', { name: 'Back' })
    const forward = screen.getByRole('button', { name: 'Forward' })
    expect(back).toBeDisabled()
    expect(forward).toBeDisabled()
    await user.click(back)
    await user.click(forward)
    expect(api.back).not.toHaveBeenCalled()
    expect(api.forward).not.toHaveBeenCalled()
  })

  it('goes back, forward and reloads', async () => {
    const { api, user } = await renderBar(makeState({ canGoBack: true, canGoForward: true }))
    const navigation = within(screen.getByRole('group', { name: 'Navigation' }))
    await user.click(navigation.getByRole('button', { name: 'Back' }))
    await user.click(navigation.getByRole('button', { name: 'Forward' }))
    await user.click(navigation.getByRole('button', { name: 'Reload' }))
    expect(api.back).toHaveBeenCalledOnce()
    expect(api.forward).toHaveBeenCalledOnce()
    expect(api.reload).toHaveBeenCalledOnce()
  })

  it('follows pushed state: history and the loading indicator', async () => {
    const { api } = await renderBar()
    expect(screen.queryByTestId('title-bar-loading')).not.toBeInTheDocument()

    act(() => api.emit(makeState({ canGoBack: true, loading: true })))
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
    expect(screen.getByTestId('title-bar-loading')).toBeInTheDocument()

    act(() => api.emit(makeState({ canGoBack: true, loading: false })))
    expect(screen.queryByTestId('title-bar-loading')).not.toBeInTheDocument()
  })

  it('keeps operating when a bridge call fails', async () => {
    const { api, user } = await renderBar()
    api.reload.mockRejectedValueOnce(new Error('gone'))
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    expect(api.reload).toHaveBeenCalledTimes(2)
  })
})

describe('application menu', () => {
  it('has no menu button where the system shows the menu', async () => {
    await renderBar(makeState({ showMenuButton: false }))
    expect(screen.queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument()
  })

  it('opens the menu under its button', async () => {
    const { api, user } = await renderBar(
      makeState({ platform: 'win32', insets: { left: 0, right: 138 }, showMenuButton: true })
    )
    const menu = screen.getByRole('button', { name: 'Menu' })
    menu.getBoundingClientRect = () => new DOMRect(8.4, 4, 32, 32)
    await user.click(menu)
    expect(api.openMenu).toHaveBeenCalledWith(8, 36)
  })

  it('lists the controls left to right in tab order', async () => {
    const { user } = await renderBar(makeState({ showMenuButton: true, canGoBack: true }))
    const expected = ['Menu', 'Back', 'Reload', 'Folder sync: Up to date. Synced folders']
    for (const name of expected) {
      await user.tab()
      expect(screen.getByRole('button', { name })).toHaveFocus()
    }
  })
})

describe('sync status pill', () => {
  const cases: [SyncHealth, string, string][] = [
    ['up-to-date', 'Up to date', 'Everything is up to date'],
    ['syncing', 'Syncing', 'Syncing your folders…'],
    ['paused', 'Paused', 'Sync is paused'],
    ['attention', 'Needs attention', 'Some files need attention'],
    ['sign-in-required', 'Reconnect needed', 'Reconnect to keep syncing'],
    ['offline', 'Offline', "Teler can't be reached. Retrying automatically."],
    ['stopped', 'Sync restarting', 'Sync stopped unexpectedly. Restarting…'],
    ['no-folders', 'No folders', 'No folders are syncing yet'],
    ['not-connected', 'Sync off', 'Folder sync is not connected'],
  ]

  it.each(cases)('%s shows "%s" and opens Synced folders', async (health, label, hint) => {
    const { api, user } = await renderBar(makeState({ health }))
    const pill = screen.getByRole('button', {
      name: `Folder sync: ${label}. Synced folders`,
    })
    expect(pill).toHaveTextContent(label)
    expect(pill).toHaveAttribute('title', hint)
    await user.click(pill)
    expect(api.openSettings).toHaveBeenCalledOnce()
  })

  it('counts pending files while syncing', async () => {
    await renderBar(makeState({ health: 'syncing', pendingFiles: 3 }))
    const pill = screen.getByRole('button', {
      name: 'Folder sync: Syncing · 3 pending. Synced folders',
    })
    expect(pill).toHaveAttribute('title', 'Syncing 3 files…')
  })
})

describe('Synced folders view', () => {
  const pill = () => screen.getByRole('button', { name: 'Folder sync: Up to date. Synced folders' })

  it('shows the pill as not pressed on the Teler page', async () => {
    await renderBar(makeState({ view: 'teler' }))
    expect(pill()).toHaveAttribute('aria-pressed', 'false')
  })

  it('presses the pill, returns to Teler from it and disables page navigation', async () => {
    const { api, user } = await renderBar(
      makeState({ view: 'sync', canGoBack: true, canGoForward: true })
    )
    expect(pill()).toHaveAttribute('aria-pressed', 'true')
    const navigation = within(screen.getByRole('group', { name: 'Navigation' }))
    for (const name of ['Back', 'Forward', 'Reload']) {
      const button = navigation.getByRole('button', { name })
      expect(button).toBeDisabled()
      await user.click(button)
    }
    expect(api.back).not.toHaveBeenCalled()
    expect(api.forward).not.toHaveBeenCalled()
    expect(api.reload).not.toHaveBeenCalled()

    // The main process toggles: from Synced folders, the pill goes back to Teler.
    await user.click(pill())
    expect(api.openSettings).toHaveBeenCalledOnce()
  })

  it('restores navigation when the Teler page is shown again', async () => {
    const { api } = await renderBar(makeState({ view: 'sync', canGoBack: true }))
    act(() => api.emit(makeState({ view: 'teler', canGoBack: true })))
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled()
    expect(pill()).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('sync a folder', () => {
  it('is left to the web app, the tray and Synced folders', async () => {
    await renderBar()
    expect(screen.queryByRole('button', { name: /sync a folder/i })).toBeNull()
  })
})

describe('appearance', () => {
  it('applies the theme, color mode and language, then follows updates', async () => {
    const { api } = await renderBar(
      makeState({ preferences: { language: 'ca', themeVariant: 'modernisme', colorMode: 'dark' } })
    )
    // The first state is applied to the document after the controls appear.
    await waitFor(() => expect(root).toHaveClass('theme-modernisme', 'dark'))
    expect(root.lang).toBe('ca')
    // The language change re-renders the bar asynchronously.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enrere' })).toBeVisible())

    await act(async () =>
      api.emit(
        makeState({ preferences: { language: 'de', themeVariant: 'dali', colorMode: 'light' } })
      )
    )
    expect(root).toHaveClass('theme-dali')
    expect(root).not.toHaveClass('theme-modernisme')
    expect(root).not.toHaveClass('dark')
    expect(root.lang).toBe('de')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Zurück' })).toBeVisible())
  })
})
