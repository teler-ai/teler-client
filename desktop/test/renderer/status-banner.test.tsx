// @vitest-environment happy-dom
import { act, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SyncHealth } from '../../src/shared/desktop-api'
import { disconnected, makeFolder, makeState } from './fake-desktop-api'
import { renderApp } from './render-app'

const banner = () => within(screen.getByTestId('status-banner'))

describe('status banner', () => {
  it.each<[SyncHealth, string]>([
    ['up-to-date', 'Everything is up to date'],
    ['paused', 'Sync is paused'],
    ['attention', 'Some files need attention'],
    ['sign-in-required', 'Reconnect to keep syncing'],
    ['offline', "Teler can't be reached. Retrying automatically."],
    ['stopped', 'Sync stopped unexpectedly. Restarting…'],
    ['no-folders', 'No folders are syncing yet'],
    ['not-connected', 'Folder sync is not connected'],
  ])('describes %s health', async (health, title) => {
    await renderApp(makeState({ health }))
    expect(banner().getByRole('status')).toHaveTextContent(title)
  })

  it('counts pending files across every folder while syncing', async () => {
    await renderApp(
      makeState({
        health: 'syncing',
        folders: [
          makeFolder({
            id: 'a',
            status: 'pending',
            counts: { synced: 1, pending: 1200, waiting: 0, problems: 0, skipped: 0 },
          }),
          makeFolder({
            id: 'b',
            status: 'pending',
            counts: { synced: 1, pending: 34, waiting: 0, problems: 0, skipped: 0 },
          }),
        ],
      })
    )
    expect(banner().getByRole('status')).toHaveTextContent('Syncing 1,234 files…')
  })

  it('uses singular copy for one pending file and generic copy for none', async () => {
    const { api } = await renderApp(
      makeState({
        health: 'syncing',
        folders: [
          makeFolder({
            status: 'pending',
            counts: { synced: 0, pending: 1, waiting: 0, problems: 0, skipped: 0 },
          }),
        ],
      })
    )
    expect(banner().getByRole('status')).toHaveTextContent('Syncing 1 file…')

    act(() => api.emit(makeState({ health: 'syncing', folders: [] })))
    expect(banner().getByRole('status')).toHaveTextContent('Syncing your folders…')
  })

  it('resumes sync from the paused banner', async () => {
    const { api, user } = await renderApp(makeState({ health: 'paused', syncPaused: true }))
    await user.click(banner().getByRole('button', { name: 'Resume' }))
    expect(api.setSyncPaused).toHaveBeenCalledWith(false)
  })

  it('reconnects from the sign-in-required banner', async () => {
    const { api, user } = await renderApp(
      makeState({ health: 'sign-in-required', connection: disconnected })
    )
    await user.click(banner().getByRole('button', { name: 'Reconnect' }))
    expect(api.connect).toHaveBeenCalledOnce()
  })

  it('offers no action for states that recover on their own', async () => {
    await renderApp(makeState({ health: 'offline' }))
    expect(banner().queryByRole('button')).not.toBeInTheDocument()
  })
})
