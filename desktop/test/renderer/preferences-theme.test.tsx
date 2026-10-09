// @vitest-environment happy-dom
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeState } from './fake-desktop-api'
import { renderApp } from './render-app'

const root = document.documentElement

afterEach(() => {
  root.className = ''
  root.removeAttribute('lang')
  root.style.colorScheme = ''
})

describe('preferences', () => {
  it('toggles open-at-login and global pause', async () => {
    const { api, user } = await renderApp(makeState({ openAtLogin: false, syncPaused: true }))
    const section = within(screen.getByRole('region', { name: 'Preferences' }))

    const openAtLogin = section.getByRole('switch', { name: 'Open Teler at login' })
    expect(openAtLogin).toHaveAttribute('aria-checked', 'false')
    expect(openAtLogin).toHaveAccessibleDescription(/from the moment you sign in/)
    await user.click(openAtLogin)
    expect(api.setOpenAtLogin).toHaveBeenCalledWith(true)

    const pause = section.getByRole('switch', { name: 'Pause syncing' })
    expect(pause).toHaveAttribute('aria-checked', 'true')
    await user.click(pause)
    expect(api.setSyncPaused).toHaveBeenCalledWith(false)
  })

  it('explains that open at login needs the installed app', async () => {
    const { api, user } = await renderApp(makeState({ openAtLoginAvailable: false }))
    const section = within(screen.getByRole('region', { name: 'Preferences' }))
    const openAtLogin = section.getByRole('switch', { name: 'Open Teler at login' })
    expect(openAtLogin).toBeDisabled()
    expect(openAtLogin).toHaveAccessibleDescription(/installed Teler app/)
    await user.click(openAtLogin)
    expect(api.setOpenAtLogin).not.toHaveBeenCalled()
  })
})

describe('appearance', () => {
  it('applies the default light theme without variant classes', async () => {
    await renderApp()
    expect(root).not.toHaveClass('dark')
    expect([...root.classList].filter((name) => name.startsWith('theme-'))).toEqual([])
    expect(root.lang).toBe('en')
    expect(root.style.colorScheme).toBe('light')
  })

  it('applies a non-default variant, dark mode, and language, then follows updates', async () => {
    const { api } = await renderApp(
      makeState({ preferences: { language: 'ca', themeVariant: 'modernisme', colorMode: 'dark' } })
    )
    expect(root).toHaveClass('theme-modernisme', 'dark')
    expect(root.lang).toBe('ca')
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Carpetes sincronitzades' })
      ).toBeVisible()
    )

    // The language change re-renders the page asynchronously.
    await act(async () =>
      api.emit(
        makeState({ preferences: { language: 'de', themeVariant: 'dali', colorMode: 'light' } })
      )
    )
    expect(root).toHaveClass('theme-dali')
    expect(root).not.toHaveClass('theme-modernisme')
    expect(root).not.toHaveClass('dark')
    expect(root.lang).toBe('de')
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Synchronisierte Ordner' })
      ).toBeVisible()
    )
  })
})
