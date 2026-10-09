// @vitest-environment happy-dom
import { act, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DesktopState, FolderRequest } from '../../src/shared/desktop-api'
import { makeFolder, makePreview, makeState } from './fake-desktop-api'
import { renderApp } from './render-app'

const LOCAL_PATH = '/Users/ana/Projects/Q3 Sales'
const organizations = [
  { id: 'org-1', name: 'Acme' },
  { id: 'org-2', name: 'Globex' },
]

const row = (name: string) => within(screen.getByRole('heading', { level: 3, name }).closest('li')!)

async function openDialog(state: Partial<DesktopState>, target?: FolderRequest['target']) {
  const app = await renderApp(makeState({ health: 'no-folders', ...state }))
  app.api.chooseFolder.mockResolvedValueOnce(LOCAL_PATH)
  if (target) {
    act(() =>
      app.api.emit(makeState({ health: 'no-folders', ...state, folderRequest: { id: 1, target } }))
    )
  } else {
    await app.user.click(screen.getByRole('button', { name: 'Add folder' }))
  }
  const dialog = within(await screen.findByRole('dialog', { name: 'Add a folder' }))
  return { ...app, dialog }
}

describe('organizations in folder rows', () => {
  it('names the organization and project before the destination', async () => {
    await renderApp(
      makeState({
        organizations,
        folders: [
          makeFolder({
            id: 'plan',
            name: 'Plan',
            organizationId: 'org-2',
            projectId: 'proj-1',
            projectName: 'Q3 Plan',
            destination: '/personal/Reports',
          }),
          makeFolder({ id: 'shared', name: 'Shared', destination: '/organization/Shared' }),
          makeFolder({ id: 'gone', name: 'Gone', organizationId: 'org-left' }),
        ],
      })
    )
    expect(
      row('Plan').getByText('Globex · Q3 Plan project · Personal files / Reports')
    ).toBeVisible()
    expect(row('Shared').getByText('Acme · Organization files / Shared')).toBeVisible()
    // An organization the account no longer lists gets a generic name.
    expect(row('Gone').getByText('Your organization · Personal files / Reports')).toBeVisible()
  })
})

describe('organization in Add folder', () => {
  it('defaults to the organization open in Teler and sends the chosen one', async () => {
    const { api, user, dialog } = await openDialog({
      organizations,
      activeOrganizationId: 'org-2',
    })
    const picker = dialog.getByRole('combobox', { name: 'Organization' })
    expect(picker).toHaveTextContent('Globex')

    await user.click(picker)
    await user.click(await screen.findByRole('option', { name: 'Acme' }))
    expect(picker).toHaveTextContent('Acme')

    await user.click(dialog.getByRole('button', { name: 'Review files' }))
    expect(api.previewFolder).toHaveBeenCalledWith({
      localPath: LOCAL_PATH,
      destination: '/personal/Q3 Sales',
      organizationId: 'org-1',
    })

    // The preview was made for one organization: it is shown, not offered.
    await dialog.findByRole('button', { name: 'Start syncing' })
    expect(dialog.queryByRole('combobox', { name: 'Organization' })).toBeNull()
    expect(dialog.getByText('Acme')).toBeVisible()

    await user.click(dialog.getByRole('button', { name: 'Start syncing' }))
    expect(api.addFolder).toHaveBeenCalledWith({
      localPath: makePreview().localPath,
      destination: makePreview().destination,
      organizationId: 'org-1',
    })
  })

  it('prefers the organization the Teler web app asked for', async () => {
    const { dialog } = await openDialog(
      { organizations, activeOrganizationId: 'org-1' },
      { organizationId: 'org-2' }
    )
    expect(dialog.getByRole('combobox', { name: 'Organization' })).toHaveTextContent('Globex')
  })

  it('falls back to the first organization when none is open in Teler', async () => {
    const { api, user, dialog } = await openDialog({ organizations, activeOrganizationId: null })
    expect(dialog.getByRole('combobox', { name: 'Organization' })).toHaveTextContent('Acme')
    await user.click(dialog.getByRole('button', { name: 'Review files' }))
    expect(api.previewFolder.mock.calls[0]?.[0]).toMatchObject({ organizationId: 'org-1' })
  })

  it('names a single organization without a picker', async () => {
    const { dialog } = await openDialog({})
    expect(dialog.queryByRole('combobox')).toBeNull()
    expect(dialog.getByText('Organization')).toBeVisible()
    expect(dialog.getByText('Acme')).toBeVisible()
  })

  it('shows no organization when the account lists none', async () => {
    const { api, user, dialog } = await openDialog({
      organizations: [],
      activeOrganizationId: null,
    })
    expect(dialog.queryByText('Organization')).toBeNull()
    await user.click(dialog.getByRole('button', { name: 'Review files' }))
    expect(api.previewFolder.mock.calls[0]?.[0]).not.toHaveProperty('organizationId')
  })
})
