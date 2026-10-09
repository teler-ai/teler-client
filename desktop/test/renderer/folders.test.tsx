// @vitest-environment happy-dom
import { act, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { disconnected, makeFolder, makeState } from './fake-desktop-api'
import { renderApp } from './render-app'

const section = () => within(screen.getByRole('region', { name: 'Folders' }))
const row = (name: string) =>
  within(section().getByRole('heading', { level: 3, name }).closest('li')!)

const folders = [
  makeFolder({ id: 'reports', name: 'Reports' }),
  makeFolder({
    id: 'sales',
    name: 'Sales',
    localPath: '/Users/ana/Library/CloudStorage/Shared drives/Commercial/Pipeline exports/Sales',
    destination: '/organization/Sales',
    status: 'attention',
    counts: { synced: 40, pending: 2, waiting: 0, problems: 3, skipped: 1 },
    problemFiles: [
      { relativePath: 'q3/forecast.xlsx', status: 'conflict', retryAt: null, reason: null },
      { relativePath: 'q3/locked.csv', status: 'unreadable', retryAt: null, reason: null },
      { relativePath: 'raw/export.parquet', status: 'quarantined', retryAt: null, reason: null },
    ],
  }),
  makeFolder({
    id: 'archive',
    name: 'Archive',
    status: 'paused',
    counts: { synced: 0, pending: 0, waiting: 0, problems: 0, skipped: 0 },
  }),
]

describe('folders', () => {
  it('lists folders with status, destination, and non-zero counts', async () => {
    await renderApp(makeState({ health: 'attention', folders }))

    expect(row('Reports').getByText('Up to date')).toBeVisible()
    expect(row('Reports').getByText('12 synced')).toBeVisible()
    expect(row('Reports').getByText('Acme · Personal files / Reports')).toBeVisible()

    const sales = row('Sales')
    expect(sales.getByText('Needs attention')).toBeVisible()
    expect(sales.getByText('40 synced · 2 pending · 3 need attention')).toBeVisible()
    expect(sales.getByText('Acme · Organization files / Sales')).toBeVisible()
    // The visible path is truncated in the middle; the full path stays available.
    const visiblePath = sales.getByTitle(folders[1].localPath)
    expect(visiblePath.textContent).toContain('…')
    expect(sales.getByText(folders[1].localPath)).toHaveClass('sr-only')

    expect(row('Archive').getByText('Paused')).toBeVisible()
    expect(row('Archive').getByText('No files synced yet')).toBeVisible()
  })

  it('expands the files that need attention with localized statuses', async () => {
    const { user } = await renderApp(makeState({ health: 'attention', folders }))
    const toggle = row('Sales').getByRole('button', { name: 'Show 3 files that need attention' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const list = within(row('Sales').getByRole('list'))
    expect(list.getAllByRole('listitem')).toHaveLength(3)
    expect(list.getByText('q3/forecast.xlsx').nextSibling).toHaveTextContent('Conflict')
    expect(list.getByText('q3/locked.csv').nextSibling).toHaveTextContent("Can't be read")
    expect(list.getByText('raw/export.parquet').nextSibling).toHaveTextContent('Needs attention')
  })

  it('labels retrying files and explains folders from another account', async () => {
    const { user } = await renderApp(
      makeState({
        health: 'attention',
        folders: [
          makeFolder({
            id: 'slow',
            name: 'Slow',
            status: 'attention',
            counts: { synced: 0, pending: 0, waiting: 0, problems: 2, skipped: 0 },
            problemFiles: [
              { relativePath: 'big.csv', status: 'retrying', retryAt: null, reason: null },
              {
                relativePath: 'huge.csv',
                status: 'failed',
                retryAt: null,
                reason: 'STORAGE_QUOTA_EXCEEDED',
              },
            ],
          }),
          makeFolder({ id: 'old', name: 'Old', status: 'other-account' }),
        ],
      })
    )
    await user.click(row('Slow').getByRole('button', { name: 'Show 2 files that need attention' }))
    expect(row('Slow').getByText('big.csv').nextSibling).toHaveTextContent('Upload will retry')
    // A failure says why when Teler did, never with the raw code.
    expect(row('Slow').getByText('huge.csv').nextSibling).toHaveTextContent(
      'Upload failed · Your Teler storage is full'
    )
    expect(row('Old').getByText('Other account')).toBeVisible()
    expect(row('Old').getByText(/syncs to a different Teler account/)).toBeVisible()
  })

  it('pauses, resumes, and reveals folders from the row menu', async () => {
    const { api, user } = await renderApp(makeState({ folders }))

    await user.click(row('Reports').getByRole('button', { name: 'Actions for Reports' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Pause syncing' }))
    expect(api.pauseFolder).toHaveBeenCalledWith('reports')

    await user.click(row('Archive').getByRole('button', { name: 'Actions for Archive' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Resume syncing' }))
    expect(api.resumeFolder).toHaveBeenCalledWith('archive')

    await user.click(row('Sales').getByRole('button', { name: 'Actions for Sales' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Show folder' }))
    expect(api.revealFolder).toHaveBeenCalledWith('sales')
  })

  it('shows a failed row action next to the folder', async () => {
    const { api, user } = await renderApp(makeState({ folders }))
    api.pauseFolder.mockResolvedValueOnce({ ok: false, error: 'network' })

    await user.click(row('Reports').getByRole('button', { name: 'Actions for Reports' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Pause syncing' }))
    expect(await row('Reports').findByRole('alert')).toHaveTextContent("Teler can't be reached")
  })

  it('confirms before it stops syncing a folder', async () => {
    const { api, user } = await renderApp(makeState({ folders }))

    await user.click(row('Reports').getByRole('button', { name: 'Actions for Reports' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Stop syncing' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Stop syncing “Reports”?' })
    expect(dialog).toHaveTextContent('Files already uploaded stay in Teler')
    expect(api.removeFolder).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Stop syncing' }))
    expect(api.removeFolder).toHaveBeenCalledWith('reports')
  })

  it('returns focus to the row menu when the confirmation is cancelled', async () => {
    const { api, user } = await renderApp(makeState({ folders }))
    const trigger = row('Reports').getByRole('button', { name: 'Actions for Reports' })

    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: 'Stop syncing' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(api.removeFolder).not.toHaveBeenCalled()
  })

  it('shows an empty state and enables adding only when connected', async () => {
    const { api } = await renderApp(makeState({ health: 'no-folders', folders: [] }))
    expect(section().getByText('No folders yet')).toBeVisible()
    expect(section().getByRole('button', { name: 'Add folder' })).toBeEnabled()

    act(() => api.emit(makeState({ health: 'not-connected', connection: disconnected })))
    const add = section().getByRole('button', { name: 'Add folder' })
    expect(add).toBeDisabled()
    expect(add).toHaveAccessibleDescription('Connect folder sync to add folders.')
  })
})
