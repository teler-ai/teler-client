// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DesktopErrorCode, FolderPreview } from '../../src/shared/desktop-api'
import { makePreview, makeState } from './fake-desktop-api'
import { renderApp } from './render-app'

const LOCAL_PATH = '/Users/ana/Projects/Q3 Sales'

async function openDialog() {
  const app = await renderApp(makeState({ health: 'no-folders' }))
  app.api.chooseFolder.mockResolvedValueOnce(LOCAL_PATH)
  await app.user.click(screen.getByRole('button', { name: 'Add folder' }))
  const dialog = within(await screen.findByRole('dialog', { name: 'Add a folder' }))
  return { ...app, dialog }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('add folder', () => {
  it('chooses, configures, previews, and starts syncing a folder', async () => {
    const { api, user, dialog } = await openDialog()
    expect(dialog.getByText(LOCAL_PATH)).toBeVisible()
    expect(dialog.getByRole('radio', { name: 'Personal files' })).toBeChecked()
    const name = dialog.getByRole('textbox', { name: 'Folder name in Teler' })
    expect(name).toHaveValue('Q3 Sales')
    expect(dialog.getByText('/personal/Q3 Sales')).toBeVisible()

    await user.click(dialog.getByRole('radio', { name: 'Organization files' }))
    await user.clear(name)
    await user.type(name, 'Sales 2026')
    expect(dialog.getByText('/organization/Sales 2026')).toBeVisible()

    const preview: FolderPreview = makePreview({
      destination: '/organization/Sales 2026',
      fileCount: 42,
      totalBytes: 3_400_000,
      sampleFiles: ['summary.xlsx', 'regions/emea.csv'],
    })
    api.previewFolder.mockResolvedValueOnce({ ok: true, value: preview })
    await user.click(dialog.getByRole('button', { name: 'Review files' }))
    expect(api.previewFolder).toHaveBeenCalledWith({
      localPath: LOCAL_PATH,
      destination: '/organization/Sales 2026',
      organizationId: 'org-1',
    })

    expect(await dialog.findByTestId('preview-summary')).toHaveTextContent(
      '42 files (3.4 MB) will upload'
    )
    expect(dialog.getByText('3 excluded by sync rules')).toBeVisible()
    expect(dialog.getByText('1 unsupported file')).toBeVisible()
    expect(dialog.getByText('and 40 more')).toBeVisible()
    expect(dialog.getByText('regions/emea.csv')).toBeVisible()
    expect(dialog.getByText(/\.telerignore file in the folder is respected/)).toBeVisible()

    await user.click(dialog.getByRole('button', { name: 'Start syncing' }))
    expect(api.addFolder).toHaveBeenCalledWith({
      localPath: preview.localPath,
      destination: '/organization/Sales 2026',
      organizationId: 'org-1',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('returns focus to Add folder when the dialog closes', async () => {
    const { user } = await openDialog()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add folder' })).toHaveFocus())
  })

  it('does nothing when the folder picker is cancelled', async () => {
    const { api, user } = await renderApp(makeState({ health: 'no-folders' }))
    await user.click(screen.getByRole('button', { name: 'Add folder' }))
    expect(api.chooseFolder).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('validates the folder name before previewing', async () => {
    const { api, user, dialog } = await openDialog()
    const name = dialog.getByRole('textbox', { name: 'Folder name in Teler' })

    await user.clear(name)
    await user.type(name, 'a/b')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription(/Use a single folder name/)
    expect(dialog.getByRole('button', { name: 'Review files' })).toBeDisabled()

    await user.type(name, '{Enter}')
    expect(api.previewFolder).not.toHaveBeenCalled()
  })

  it.each<[DesktopErrorCode, string]>([
    ['invalid-folder', "This folder can't be synced. Choose a different folder."],
    ['invalid-destination', "This destination isn't valid. Choose a different name."],
    ['already-synced', 'This folder is already syncing.'],
    ['not-connected', 'Connect folder sync first.'],
    ['network', "Teler can't be reached. Check your connection and try again."],
    ['no-organization', "Your Teler account isn't in an organization that sync can use."],
    ['sync-failed', 'Something went wrong with sync. Try again.'],
  ])('maps a %s preview error to a message', async (error, message) => {
    const { api, user, dialog } = await openDialog()
    api.previewFolder.mockResolvedValueOnce({ ok: false, error })
    await user.click(dialog.getByRole('button', { name: 'Review files' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent(message)
  })

  it('keeps the dialog open and explains a failed add', async () => {
    const { api, user, dialog } = await openDialog()
    await user.click(dialog.getByRole('button', { name: 'Review files' }))
    api.addFolder.mockResolvedValueOnce({ ok: false, error: 'already-synced' })
    await user.click(await dialog.findByRole('button', { name: 'Start syncing' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('This folder is already syncing.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('prevents double submits while starting sync', async () => {
    const { api, user, dialog } = await openDialog()
    await user.click(dialog.getByRole('button', { name: 'Review files' }))
    const pending = deferred<Awaited<ReturnType<typeof api.addFolder>>>()
    api.addFolder.mockReturnValueOnce(pending.promise)

    const start = await dialog.findByRole('button', { name: 'Start syncing' })
    await user.click(start)
    expect(start).toBeDisabled()
    expect(dialog.getByRole('button', { name: 'Back' })).toBeDisabled()
    await user.click(start)
    expect(api.addFolder).toHaveBeenCalledOnce()

    pending.resolve({ ok: false, error: 'network' })
    expect(await dialog.findByRole('alert')).toBeVisible()
  })

  it('offers to start without a preview when previewing times out', async () => {
    const { api, user, dialog } = await openDialog()
    expect(dialog.queryByRole('button', { name: 'Start syncing without preview' })).toBeNull()
    api.previewFolder.mockResolvedValueOnce({ ok: false, error: 'timeout' })
    await user.click(dialog.getByRole('button', { name: 'Review files' }))
    expect(await dialog.findByText('This is taking longer than expected.')).toBeVisible()

    await user.click(dialog.getByRole('button', { name: 'Start syncing without preview' }))
    expect(api.addFolder).toHaveBeenCalledWith({
      localPath: LOCAL_PATH,
      destination: '/personal/Q3 Sales',
      organizationId: 'org-1',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('cancels from the destination step and goes back from the preview', async () => {
    const { api, user, dialog } = await openDialog()
    await user.click(dialog.getByRole('button', { name: 'Review files' }))
    await user.click(await dialog.findByRole('button', { name: 'Back' }))
    expect(dialog.getByRole('textbox', { name: 'Folder name in Teler' })).toHaveValue('Q3 Sales')

    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.addFolder).not.toHaveBeenCalled()
  })
})
