// @vitest-environment happy-dom
import { act, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { NotificationSettings } from '../../src/shared/desktop-api'
import { makeState } from './fake-desktop-api'
import { renderApp } from './render-app'

const SWITCHES = [
  ['files', 'Files ready', /files are ready in Teler, grouped together/],
  ['folders', 'Folder synced', /finishes its first sync/],
  ['problems', 'Files need attention', /When files need attention/],
  ['chats', 'Chat answered', /finishes answering in a chat/],
  ['alerts', 'Agent alerts', /When an Agent alerts you, and when it.s back to normal/],
  ['sound', 'Play a sound', /system's notification sound/],
] as const

const allOff: NotificationSettings = {
  files: false,
  folders: false,
  problems: false,
  chats: false,
  alerts: false,
  sound: true,
}

function notificationsSection() {
  return within(screen.getByRole('region', { name: 'Notifications' }))
}

describe('notifications', () => {
  it('says notifications stay hidden while Teler is in front', async () => {
    await renderApp()
    expect(notificationsSection().getByText('Not shown while Teler is in front.')).toBeVisible()
  })

  it.each(SWITCHES)('turns %s notifications off and on', async (setting, name, hint) => {
    const { api, user } = await renderApp()
    const control = notificationsSection().getByRole('switch', { name })
    expect(control).toHaveAttribute('aria-checked', 'true')
    expect(control).toHaveAccessibleDescription(hint)

    await user.click(control)
    expect(api.setNotificationSetting).toHaveBeenCalledWith(setting, false)

    await act(async () =>
      api.emit(makeState({ notifications: { ...makeState().notifications, [setting]: false } }))
    )
    expect(control).toHaveAttribute('aria-checked', 'false')
    await user.click(control)
    expect(api.setNotificationSetting).toHaveBeenLastCalledWith(setting, true)
  })

  it('shows each switch as the pushed settings say', async () => {
    await renderApp(
      makeState({
        notifications: {
          files: false,
          folders: true,
          problems: false,
          chats: true,
          alerts: true,
          sound: false,
        },
      })
    )
    const section = notificationsSection()
    const checked = (name: string) =>
      section.getByRole('switch', { name }).getAttribute('aria-checked')
    expect(checked('Files ready')).toBe('false')
    expect(checked('Folder synced')).toBe('true')
    expect(checked('Files need attention')).toBe('false')
    expect(checked('Chat answered')).toBe('true')
    expect(checked('Agent alerts')).toBe('true')
    expect(checked('Play a sound')).toBe('false')
  })

  it('disables the sound while every notification is off', async () => {
    const { api, user } = await renderApp(makeState({ notifications: allOff }))
    const sound = notificationsSection().getByRole('switch', { name: 'Play a sound' })
    expect(sound).toBeDisabled()
    expect(sound).toHaveAccessibleDescription(/Turn on a notification above/)
    await user.click(sound)
    expect(api.setNotificationSetting).not.toHaveBeenCalled()

    await act(async () => api.emit(makeState({ notifications: { ...allOff, chats: true } })))
    expect(sound).toBeEnabled()
    expect(sound).toHaveAccessibleDescription(/system's notification sound/)

    // Agent alerts alone are enough to play it.
    await act(async () => api.emit(makeState({ notifications: { ...allOff, alerts: true } })))
    expect(sound).toBeEnabled()
  })
})
