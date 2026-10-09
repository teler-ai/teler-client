// @vitest-environment happy-dom
import { act, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { disconnected, makeState } from './fake-desktop-api'
import { renderApp } from './render-app'

const section = () => within(screen.getByRole('region', { name: 'Connection' }))

const connecting = makeState({
  health: 'not-connected',
  connection: { status: 'connecting', account: null, error: null },
})

describe('connection', () => {
  it('explains sync and connects with the signed-in account when disconnected', async () => {
    const { api, user } = await renderApp(
      makeState({ health: 'not-connected', connection: disconnected })
    )
    expect(screen.getByText('Folder sync is not connected', { selector: 'header p' })).toBeVisible()
    expect(section().getByText(/It uses the account you're signed in to in Teler\./)).toBeVisible()

    await user.click(section().getByRole('button', { name: 'Connect folder sync' }))
    expect(api.connect).toHaveBeenCalledOnce()

    act(() => api.emit(connecting))
    expect(await section().findByRole('status')).toHaveTextContent(
      'Connecting to your Teler account…'
    )
  })

  it('shows a status without a code or cancel while connecting', async () => {
    await renderApp(connecting)
    expect(section().getByRole('status')).toHaveTextContent('Connecting to your Teler account…')
    expect(section().queryByText(/code/i)).toBeNull()
    expect(section().queryByRole('button')).toBeNull()
  })

  it('asks to sign in to Teler when nobody is signed in', async () => {
    const { api, user } = await renderApp(
      makeState({ health: 'not-connected', connection: disconnected })
    )
    api.connect.mockResolvedValueOnce({ ok: false, error: 'signed-out' })
    await user.click(section().getByRole('button', { name: 'Connect folder sync' }))

    expect(await section().findByRole('alert')).toHaveTextContent(
      "You're signed out of Teler. Folder sync connects once you sign in."
    )
    await user.click(section().getByRole('button', { name: 'Sign in to Teler' }))
    expect(api.openTeler).toHaveBeenCalledOnce()
  })

  it('shows a signed-out error pushed by the app and clears it on the next attempt', async () => {
    const { api } = await renderApp(
      makeState({ health: 'not-connected', connection: { ...disconnected, error: 'signed-out' } })
    )
    expect(section().getByRole('alert')).toHaveTextContent("You're signed out of Teler.")
    expect(section().getByRole('button', { name: 'Sign in to Teler' })).toBeVisible()

    act(() => api.emit(connecting))
    expect(section().queryByRole('alert')).toBeNull()
  })

  it('keeps a failed attempt visible after it ends and clears it when sync reconnects', async () => {
    const { api, user } = await renderApp(
      makeState({ health: 'not-connected', connection: disconnected })
    )
    api.connect.mockImplementationOnce(async () => {
      api.emit(connecting)
      return { ok: false, error: 'signed-out' }
    })
    await user.click(section().getByRole('button', { name: 'Connect folder sync' }))
    act(() => api.emit(makeState({ health: 'not-connected', connection: disconnected })))
    expect(await section().findByRole('alert')).toHaveTextContent("You're signed out of Teler")

    // Signing in to the Teler window reconnects sync automatically.
    act(() => api.emit(connecting))
    expect(section().queryByRole('alert')).toBeNull()
  })

  it('shows the account in the header when connected', async () => {
    await renderApp(makeState())
    expect(screen.getByText('Syncing as Ana Puig')).toBeVisible()
    expect(section().getByText('Connected as Ana Puig')).toBeVisible()
  })

  it('falls back to generic copy when the account has no name', async () => {
    await renderApp(
      makeState({
        connection: { status: 'connected', account: { id: 'u', name: null }, error: null },
      })
    )
    expect(screen.getByText('Folder sync is connected')).toBeVisible()
    expect(section().getByText('Connected to Teler')).toBeVisible()
  })

  it('maps connection errors to localized messages', async () => {
    await renderApp(
      makeState({
        health: 'not-connected',
        connection: { ...disconnected, error: 'connect-expired' },
      })
    )
    expect(section().getByRole('alert')).toHaveTextContent('Connecting took too long. Try again.')
    expect(section().queryByRole('button', { name: 'Sign in to Teler' })).toBeNull()
  })

  it('reports a failed connect attempt', async () => {
    const { api, user } = await renderApp(
      makeState({ health: 'not-connected', connection: disconnected })
    )
    api.connect.mockResolvedValueOnce({ ok: false, error: 'no-organization' })
    await user.click(section().getByRole('button', { name: 'Connect folder sync' }))
    expect(await section().findByRole('alert')).toHaveTextContent(
      "Your Teler account isn't in an organization that sync can use."
    )
  })

  it('warns when the connection only lasts for this session', async () => {
    await renderApp(makeState({ credentialPersistence: 'session' }))
    expect(section().getByText(/No system keyring is available/)).toBeVisible()
  })

  it('confirms before disconnecting', async () => {
    const { api, user } = await renderApp(makeState())
    await user.click(section().getByRole('button', { name: 'Disconnect' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Disconnect folder sync?' })
    expect(dialog).toHaveTextContent(
      'Sync stays off on this computer until you connect again. Your folders and files are kept'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.disconnect).not.toHaveBeenCalled()

    await user.click(section().getByRole('button', { name: 'Disconnect' }))
    const again = await screen.findByRole('alertdialog')
    await user.click(within(again).getByRole('button', { name: 'Disconnect' }))
    expect(api.disconnect).toHaveBeenCalledOnce()
  })
})
