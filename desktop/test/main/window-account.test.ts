import { describe, expect, it } from 'vitest'
import { WindowAccount } from '../../src/main/window-account'

const authOrigin = 'https://app.teler.ai'

function account(replies: { organizations: Response | Error; session: Response | Error }) {
  let changes = 0
  const fetch = async (url: string) => {
    const reply = url.endsWith('/api/user/organizations') ? replies.organizations : replies.session
    if (reply instanceof Error) throw reply
    return reply.clone()
  }
  const value = new WindowAccount(authOrigin, fetch, () => changes++)
  return { value, changes: () => changes, replies }
}

const listed = Response.json({
  success: true,
  data: [
    { id: 'org_a', name: 'Acme', role: 'owner' },
    { id: 'org_b', name: 'Beta', role: 'member' },
  ],
})
const session = Response.json({ session: { activeOrganizationId: 'org_b' }, user: { id: 'u' } })

describe('window account', () => {
  it('knows the organizations and the one open in Teler', async () => {
    const { value, changes } = account({ organizations: listed, session })
    await value.refresh()
    expect(value.organizations).toEqual([
      { id: 'org_a', name: 'Acme' },
      { id: 'org_b', name: 'Beta' },
    ])
    expect(value.activeOrganizationId).toBe('org_b')
    expect(changes()).toBe(1)
  })

  it('forgets them when the window signs out, and keeps them while offline', async () => {
    const signedIn = account({ organizations: listed, session })
    await signedIn.value.refresh()
    signedIn.replies.organizations = new Error('offline')
    signedIn.replies.session = new Error('offline')
    await signedIn.value.refresh()
    expect(signedIn.value.organizations).toHaveLength(2)
    expect(signedIn.value.activeOrganizationId).toBe('org_b')

    signedIn.replies.organizations = Response.json({ success: false }, { status: 401 })
    signedIn.replies.session = Response.json(null)
    await signedIn.value.refresh()
    expect(signedIn.value.organizations).toEqual([])
    expect(signedIn.value.activeOrganizationId).toBeNull()
  })
})
