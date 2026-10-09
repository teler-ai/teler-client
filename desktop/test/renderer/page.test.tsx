// @vitest-environment happy-dom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/renderer/app'
import { DesktopApiProvider } from '../../src/renderer/desktop-api-context'
import i18n from '../../src/renderer/i18n'
import { createFakeDesktopApi, makeFolder, makeState } from './fake-desktop-api'
import { renderApp } from './render-app'

describe('Synced folders page', () => {
  it('reads as a page with a way back to Teler', async () => {
    const { api, user } = await renderApp()
    expect(screen.getByRole('heading', { level: 1, name: 'Synced folders' })).toBeVisible()
    expect(screen.getByText('Syncing as Ana Puig')).toBeVisible()
    // The Teler page is one click away, so there is no separate "Open Teler".
    expect(screen.queryByRole('button', { name: 'Open Teler' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Back to Teler' }))
    expect(api.openTeler).toHaveBeenCalledOnce()
    expect(api.openTeler).toHaveBeenCalledWith()
  })

  it('offers the way back even when the page cannot load', async () => {
    await i18n.changeLanguage('en')
    const api = createFakeDesktopApi()
    api.getState.mockRejectedValueOnce(new Error('main process busy'))
    const user = userEvent.setup()
    render(
      <DesktopApiProvider api={api}>
        <App />
      </DesktopApiProvider>
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Teler Desktop couldn't load its sync settings."
    )
    await user.click(screen.getByRole('button', { name: 'Back to Teler' }))
    expect(api.openTeler).toHaveBeenCalledOnce()
  })

  it('returns to Teler on Escape', async () => {
    const { api, user } = await renderApp()
    await user.keyboard('{Escape}')
    expect(api.openTeler).toHaveBeenCalledOnce()
  })

  it('lets an open dialog take Escape first', async () => {
    const { api, user } = await renderApp(makeState({ health: 'no-folders' }))
    api.chooseFolder.mockResolvedValueOnce('/Users/ana/Reports')
    await user.click(screen.getByRole('button', { name: 'Add folder' }))
    await screen.findByRole('dialog', { name: 'Add a folder' })

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.openTeler).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(api.openTeler).toHaveBeenCalledOnce()
  })

  it('lets an open menu take Escape first', async () => {
    const { api, user } = await renderApp(makeState({ folders: [makeFolder()] }))
    await user.click(screen.getByRole('button', { name: 'Actions for Reports' }))
    await screen.findByRole('menu')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(api.openTeler).not.toHaveBeenCalled()
  })
})
