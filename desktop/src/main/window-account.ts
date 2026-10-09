import type { OrganizationSummary } from '../shared/desktop-api'
import type { FetchLike } from './device-login'
import { listOrganizations, readWindowSession } from './window-session'

/**
 * What the app shows about the account signed in to the Teler window: its
 * organizations (to show and choose where folders sync) and the one open in
 * Teler. Values that cannot be read right now (offline) are kept.
 */
export class WindowAccount {
  organizations: OrganizationSummary[] = []
  activeOrganizationId: string | null = null

  constructor(
    private readonly authOrigin: string,
    private readonly fetch: FetchLike,
    private readonly onChange: () => void
  ) {}

  async refresh(): Promise<void> {
    const [organizations, session] = await Promise.all([
      listOrganizations(this.authOrigin, this.fetch),
      readWindowSession(this.authOrigin, this.fetch),
    ])
    if (organizations !== undefined) this.organizations = organizations
    if (session !== undefined) this.activeOrganizationId = session?.activeOrganizationId ?? null
    this.onChange()
  }
}
