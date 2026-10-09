import { describe, expect, it } from 'vitest'
import { isTelerPage, parseSyncFolderAction } from '../../src/main/sync-target'

const ORG = 'org_01h455vb4pex5vsknk084sn02q'
const PROJECT = 'prj_01h455vb4pex5vsknk084sn02r'
const action = (query: Record<string, string>) =>
  `teler-desktop://sync-folder?${new URLSearchParams(query).toString()}`

describe('sync a folder from the web app', () => {
  it('reads the organization and project to sync into', () => {
    expect(
      parseSyncFolderAction(
        action({ organizationId: ORG, projectId: PROJECT, projectName: '  Q3 & Q4 / plan  ' })
      )
    ).toEqual({ organizationId: ORG, projectId: PROJECT, projectName: 'Q3 & Q4 / plan' })
    expect(parseSyncFolderAction(action({ organizationId: ORG }))).toEqual({
      organizationId: ORG,
    })
    expect(parseSyncFolderAction('teler-desktop://sync-folder')).toEqual({})
  })

  it('caps the project name, which is only displayed', () => {
    const target = parseSyncFolderAction(
      action({ organizationId: ORG, projectId: PROJECT, projectName: 'x'.repeat(500) })
    )
    expect(target?.projectName).toHaveLength(200)
  })

  it('refuses other actions and malformed or orphaned identifiers', () => {
    expect(parseSyncFolderAction('teler-desktop://app/index.html')).toBeNull()
    expect(parseSyncFolderAction('https://sync-folder/?organizationId=x')).toBeNull()
    expect(parseSyncFolderAction(action({ organizationId: 'acme' }))).toBeNull()
    expect(parseSyncFolderAction(action({ organizationId: ORG, projectId: 'p' }))).toBeNull()
    // A project always belongs to an organization the request names.
    expect(parseSyncFolderAction(action({ projectId: PROJECT }))).toBeNull()
    expect(parseSyncFolderAction('not a url')).toBeNull()
  })

  it('accepts requests only from Teler pages', () => {
    expect(isTelerPage('https://app.teler.ai/projects/x', 'https://app.teler.ai')).toBe(true)
    expect(isTelerPage('https://accounts.google.com/o/oauth2', 'https://app.teler.ai')).toBe(false)
    expect(isTelerPage('', 'https://app.teler.ai')).toBe(false)
  })
})
