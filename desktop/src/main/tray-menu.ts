import type { DesktopState, SyncHealth } from '../shared/desktop-api'
import type { MessageKey, Translate } from './i18n'
import { pendingFileCount } from './sync-state'

export type TrayAction =
  | 'open-teler'
  | 'open-running'
  | 'open-agents'
  | 'open-waiting'
  | 'open-settings'
  | 'sync-folder'
  | 'pause-sync'
  | 'resume-sync'
  | 'connect'
  | 'toggle-open-at-login'
  | 'install-update'
  | 'quit'

export type TrayMenuItem =
  | { type: 'separator' }
  | { type: 'action'; action: TrayAction; label: string }
  | { type: 'checkbox'; action: TrayAction; label: string; checked: boolean }

export type TrayState = Pick<
  DesktopState,
  | 'health'
  | 'connection'
  | 'syncPaused'
  | 'openAtLogin'
  | 'openAtLoginAvailable'
  | 'folders'
  | 'organizations'
  | 'activeOrganizationId'
  | 'activity'
> & {
  /** A newer Teler Desktop release. */
  update?: { version: string } | null
}

/** Finished chats not yet opened and unread notices: what waits for the person. */
export function waitingCount(activity: TrayState['activity']): number {
  return activity ? activity.waitingChats + activity.unreadNotifications : 0
}

function runningCount(activity: TrayState['activity']): number {
  return activity ? activity.runningChats + activity.runningAgents : 0
}

const STATUS_KEYS: Record<SyncHealth, MessageKey> = {
  'not-connected': 'tray.status.not-connected',
  'no-folders': 'tray.status.no-folders',
  'up-to-date': 'tray.status.up-to-date',
  syncing: 'tray.status.syncing',
  paused: 'tray.status.paused',
  attention: 'tray.status.attention',
  'sign-in-required': 'tray.status.sign-in-required',
  offline: 'tray.status.offline',
  stopped: 'tray.status.stopped',
}

export function trayStatusLabel(state: TrayState, t: Translate): string {
  return t(STATUS_KEYS[state.health], { count: pendingFileCount(state.folders) })
}

/** The tray tooltip: product name, the current sync state, and what runs and waits. */
export function trayTooltip(state: TrayState, t: Translate): string {
  const parts = [trayStatusLabel(state, t)]
  const running = runningCount(state.activity)
  const waiting = waitingCount(state.activity)
  if (running > 0) parts.push(t('tray.tooltip.running', { count: running }))
  if (waiting > 0) parts.push(t('tray.tooltip.waiting', { count: waiting }))
  return `Teler — ${parts.join(' · ')}`
}

/** What runs and what waits: the chat lines open their most recent chat, Agents the Agents page. */
function activityItems(state: TrayState, t: Translate): TrayMenuItem[] {
  const { activity } = state
  if (!activity) return []
  const items: TrayMenuItem[] = []
  if (activity.runningChats > 0)
    items.push({
      type: 'action',
      action: 'open-running',
      label: t('tray.running.chats', { count: activity.runningChats }),
    })
  if (activity.runningAgents > 0)
    items.push({
      type: 'action',
      action: 'open-agents',
      label: t('tray.running.agents', { count: activity.runningAgents }),
    })
  const waiting = waitingCount(activity)
  if (waiting > 0)
    items.push({
      type: 'action',
      action: 'open-waiting',
      label: t('tray.waiting', { count: waiting }),
    })
  return items.length > 0 ? [{ type: 'separator' }, ...items] : []
}

/** The first line: the sync state, which opens Synced folders or (re)connects. */
function statusItem(state: TrayState, t: Translate): TrayMenuItem {
  if (state.connection.status !== 'connected')
    return { type: 'action', action: 'connect', label: t('tray.connect') }
  if (state.health === 'sign-in-required')
    return { type: 'action', action: 'connect', label: t('tray.reconnect') }
  return { type: 'action', action: 'open-settings', label: trayStatusLabel(state, t) }
}

/** The second line: who is syncing and the organization open in Teler; opens Teler. */
function accountLabel(state: TrayState, t: Translate): string {
  const name = state.connection.status === 'connected' ? state.connection.account?.name : null
  if (!name) return t('tray.openTeler')
  const organization = state.organizations.find((item) => item.id === state.activeOrganizationId)
  return organization
    ? t('tray.accountWithOrganization', { name, organization: organization.name })
    : name
}

/**
 * Every line acts: the status opens Synced folders and the account opens
 * Teler, so neither needs its own item.
 */
export function buildTrayMenu(state: TrayState, t: Translate): TrayMenuItem[] {
  const items: TrayMenuItem[] = [
    statusItem(state, t),
    { type: 'action', action: 'open-teler', label: accountLabel(state, t) },
    ...activityItems(state, t),
    { type: 'separator' },
    { type: 'action', action: 'sync-folder', label: t('tray.syncFolder') },
  ]
  if (
    state.connection.status === 'connected' &&
    state.health !== 'sign-in-required' &&
    state.folders.length > 0
  )
    items.push(
      state.syncPaused
        ? { type: 'action', action: 'resume-sync', label: t('tray.resume') }
        : { type: 'action', action: 'pause-sync', label: t('tray.pause') }
    )
  if (state.update)
    items.push(
      { type: 'separator' },
      {
        type: 'action',
        action: 'install-update',
        label: t('tray.update', { version: state.update.version }),
      }
    )
  if (state.openAtLoginAvailable)
    items.push(
      { type: 'separator' },
      {
        type: 'checkbox',
        action: 'toggle-open-at-login',
        label: t('tray.openAtLogin'),
        checked: state.openAtLogin,
      }
    )
  items.push({ type: 'separator' }, { type: 'action', action: 'quit', label: t('tray.quit') })
  return items
}
