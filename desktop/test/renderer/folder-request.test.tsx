// @vitest-environment happy-dom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/renderer/app'
import { DesktopApiProvider } from '../../src/renderer/desktop-api-context'
import i18n from '../../src/renderer/i18n'
import type { DesktopState, FolderRequest } from '../../src/shared/desktop-api'
import { createFakeDesktopApi, disconnected, makePreview, makeState } from './fake-desktop-api'
import { renderApp } from './render-app'

const LOCAL_PATH = '/Users/ana/Projects/Q3 Sales'

const request = (id: number, target: FolderRequest['target'] = {}): FolderRequest => ({
  id,
  target,
})

const connected = (folderRequest: FolderRequest | null): DesktopState =>
  makeState({ health: 'no-folders', folderRequest })

const connecting = (folderRequest: FolderRequest | null): DesktopState =>
  makeState({
    health: 'not-connected',
    connection: { status: 'connecting', account: null, error: null },
    folderRequest,
  })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('folder requests from the Teler web app', () => {
  it('opens the folder picker once when connected and dismisses the request', async () => {
    const { api } = await renderApp(connected(request(1)))
    await waitFor(() => expect(api.chooseFolder).toHaveBeenCalledOnce())
    expect(api.dismissFolderRequest).toHaveBeenCalledWith(1)

    // The same request pushed again (before the dismissal lands) is not repeated.
    act(() => api.emit(connected(request(1))))
    act(() => api.emit(connected(null)))
    expect(api.chooseFolder).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => api.emit(connected(request(2))))
    await waitFor(() => expect(api.chooseFolder).toHaveBeenCalledTimes(2))
    expect(api.dismissFolderRequest).toHaveBeenLastCalledWith(2)
  })

  it('opens the picker once under StrictMode', async () => {
    await i18n.changeLanguage('en')
    const api = createFakeDesktopApi(connected(request(9)))
    render(
      <StrictMode>
        <DesktopApiProvider api={api}>
          <App />
        </DesktopApiProvider>
      </StrictMode>
    )
    await screen.findByRole('heading', { level: 1, name: 'Synced folders' })
    await waitFor(() => expect(api.dismissFolderRequest).toHaveBeenCalledWith(9))
    expect(api.chooseFolder).toHaveBeenCalledOnce()
    expect(api.dismissFolderRequest).toHaveBeenCalledOnce()
  })

  it('waits while connecting and opens the picker once connected', async () => {
    const { api } = await renderApp(connecting(request(4)))
    expect(api.chooseFolder).not.toHaveBeenCalled()

    act(() => api.emit(makeState({ health: 'not-connected', connection: disconnected })))
    act(() => api.emit(connecting(request(4))))
    expect(api.chooseFolder).not.toHaveBeenCalled()
    expect(api.dismissFolderRequest).not.toHaveBeenCalled()

    api.chooseFolder.mockResolvedValueOnce(LOCAL_PATH)
    act(() => api.emit(connected(request(4))))
    await waitFor(() => expect(api.dismissFolderRequest).toHaveBeenCalledWith(4))
    expect(await screen.findByRole('dialog', { name: 'Add a folder' })).toBeVisible()
    expect(api.chooseFolder).toHaveBeenCalledOnce()
  })

  it('handles a request that arrives during an open dialog after it closes', async () => {
    const { api, user } = await renderApp(connected(null))
    api.chooseFolder.mockResolvedValueOnce(LOCAL_PATH)
    await user.click(screen.getByRole('button', { name: 'Add folder' }))
    await screen.findByRole('dialog', { name: 'Add a folder' })

    act(() => api.emit(connected(request(7, { projectId: 'p-1', projectName: 'Forecasts' }))))
    expect(api.chooseFolder).toHaveBeenCalledOnce()
    expect(api.dismissFolderRequest).not.toHaveBeenCalled()

    api.chooseFolder.mockResolvedValueOnce('/Users/ana/Forecasts')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(api.dismissFolderRequest).toHaveBeenCalledWith(7))
    const dialog = await screen.findByRole('dialog', { name: 'Add a folder' })
    expect(within(dialog).getByText('Adds to the project Forecasts')).toBeVisible()
  })

  it('does not stack pickers while the Add folder picker is open', async () => {
    const { api, user } = await renderApp(connected(null))
    const picking = deferred<string | null>()
    api.chooseFolder.mockReturnValueOnce(picking.promise)
    await user.click(screen.getByRole('button', { name: 'Add folder' }))

    act(() => api.emit(connected(request(3))))
    expect(api.chooseFolder).toHaveBeenCalledOnce()

    await act(async () => picking.resolve(null))
    await waitFor(() => expect(api.chooseFolder).toHaveBeenCalledTimes(2))
    expect(api.dismissFolderRequest).toHaveBeenCalledWith(3)
  })

  it('adds to the requested project, sending its organization, id and name', async () => {
    const target = { organizationId: 'org-2', projectId: 'proj-9', projectName: 'Q3 Planning' }
    const { api, user } = await renderApp(
      makeState({
        health: 'no-folders',
        organizations: [
          { id: 'org-1', name: 'Acme' },
          { id: 'org-2', name: 'Globex' },
        ],
      })
    )
    api.chooseFolder.mockResolvedValueOnce(LOCAL_PATH)
    act(() =>
      api.emit(
        makeState({
          health: 'no-folders',
          folderRequest: request(5, target),
          organizations: [
            { id: 'org-1', name: 'Acme' },
            { id: 'org-2', name: 'Globex' },
          ],
        })
      )
    )
    const dialog = within(await screen.findByRole('dialog', { name: 'Add a folder' }))
    expect(dialog.getByText('Adds to the project Q3 Planning')).toBeVisible()
    // A project belongs to one organization, so it is shown but not offered.
    expect(dialog.getByText('Globex')).toBeVisible()
    expect(dialog.queryByRole('combobox', { name: 'Organization' })).toBeNull()

    const ids = { organizationId: 'org-2', projectId: 'proj-9', projectName: 'Q3 Planning' }
    await user.click(dialog.getByRole('button', { name: 'Review files' }))
    expect(api.previewFolder).toHaveBeenCalledWith({
      localPath: LOCAL_PATH,
      destination: '/personal/Q3 Sales',
      ...ids,
    })

    await user.click(await dialog.findByRole('button', { name: 'Start syncing' }))
    const preview = makePreview()
    expect(api.addFolder).toHaveBeenCalledWith({
      localPath: preview.localPath,
      destination: preview.destination,
      ...ids,
    })
  })

  it('names a project without a display name generically', async () => {
    const { api } = await renderApp(connected(null))
    api.chooseFolder.mockResolvedValueOnce(LOCAL_PATH)
    act(() => api.emit(connected(request(6, { projectId: 'proj-9' }))))
    const dialog = within(await screen.findByRole('dialog', { name: 'Add a folder' }))
    expect(dialog.getByText('Adds to the selected project')).toBeVisible()
  })

  it('shows no project and sends only the organization for a plain Add folder', async () => {
    const { api, user } = await renderApp(connected(null))
    api.chooseFolder.mockResolvedValueOnce(LOCAL_PATH)
    await user.click(screen.getByRole('button', { name: 'Add folder' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Add a folder' }))
    expect(dialog.queryByText(/Adds to the/)).toBeNull()

    await user.click(dialog.getByRole('button', { name: 'Review files' }))
    expect(api.previewFolder.mock.calls[0]?.[0]).toStrictEqual({
      localPath: LOCAL_PATH,
      destination: '/personal/Q3 Sales',
      organizationId: 'org-1',
    })
    expect(api.dismissFolderRequest).not.toHaveBeenCalled()
  })
})
