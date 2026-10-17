import { basename } from 'node:path'
import type { Translate } from '../i18n'
import type { SupportedLanguage } from '../../shared/languages'
import type {
  AlertEvent,
  ChatFinishedEvent,
  ComposedNotification,
  FileReadyEvent,
  FolderAttentionEvent,
  FolderSyncedEvent,
  InboxEvent,
  NotificationEvent,
  NotificationKind,
  NotificationTarget,
} from './types'

/** The organization all items share, or null when they differ. */
function sharedOrganization(items: Array<{ organizationId: string | null }>): string | null {
  const first = items[0]?.organizationId ?? null
  return items.every((item) => item.organizationId === first) ? first : null
}

function composeFiles(items: FileReadyEvent[], t: Translate): ComposedNotification {
  const organizationId = sharedOrganization(items)
  const [only] = items
  if (only && items.length === 1) {
    const name = basename(only.path)
    return {
      kind: 'files',
      title: t(only.updated ? 'notification.file.updated' : 'notification.file.ready', { name }),
      body: only.folderName,
      target: {
        type: 'teler',
        path: only.documentId ? `/data?file=${only.documentId}` : '/data',
        organizationId,
      },
    }
  }
  const updated = items.filter((item) => item.updated).length
  const added = items.length - updated
  const folders = new Set(items.map((item) => item.folderId)).size
  const parts = [
    ...(added > 0 ? [t('notification.files.new', { count: added })] : []),
    ...(updated > 0 ? [t('notification.files.updated', { count: updated })] : []),
    folders === 1
      ? (items[0]?.folderName ?? '')
      : t('notification.files.folders', { count: folders }),
  ]
  return {
    kind: 'files',
    title: t('notification.files.title', { count: items.length }),
    body: parts.join(' · '),
    target: { type: 'teler', path: '/data', organizationId },
  }
}

function composeFolders(items: FolderSyncedEvent[], t: Translate): ComposedNotification {
  const [only] = items
  return {
    kind: 'folders',
    title:
      only && items.length === 1
        ? t('notification.folder.title', { name: only.folderName })
        : t('notification.folders.title', { count: items.length }),
    body:
      only && items.length === 1
        ? t(only.files === 1 ? 'notification.folder.oneFile' : 'notification.folder.files', {
            count: only.files,
          })
        : items.map((item) => item.folderName).join(', '),
    target: { type: 'teler', path: '/data', organizationId: sharedOrganization(items) },
  }
}

function composeProblems(items: FolderAttentionEvent[], t: Translate): ComposedNotification {
  // The latest count per folder.
  const byFolder = new Map(items.map((item) => [item.folderId, item]))
  const folders = [...byFolder.values()]
  const total = folders.reduce((sum, item) => sum + item.problems, 0)
  const [only] = folders
  return {
    kind: 'problems',
    title: t('notification.problems.title'),
    body:
      only && folders.length === 1
        ? t(total === 1 ? 'notification.problems.oneFile' : 'notification.problems.files', {
            count: total,
            folder: only.folderName,
          })
        : t('notification.problems.folders', { count: total, folders: folders.length }),
    target: { type: 'synced-folders' },
  }
}

/** A turn that stopped for an approval did not finish its work: it asks for the answer. */
function chatsTitle(items: ChatFinishedEvent[], t: Translate): string {
  const awaiting = items.filter((item) => item.awaitingApproval).length
  if (items.length === 1)
    return t(awaiting ? 'notification.chat.approvalTitle' : 'notification.chat.title')
  if (awaiting === items.length)
    return t('notification.chats.approvalTitle', { count: items.length })
  return awaiting > 0
    ? t('notification.chats.waiting', { count: items.length })
    : t('notification.chats.title', { count: items.length })
}

function composeChats(items: ChatFinishedEvent[], t: Translate): ComposedNotification {
  // The latest chat is the one to open.
  const latest = items[items.length - 1]
  const titled = items.find((item) => item.title)?.title ?? t('notification.chat.untitled')
  return {
    kind: 'chats',
    title: chatsTitle(items, t),
    body:
      items.length === 1
        ? (latest?.title ?? t('notification.chat.untitled'))
        : t('notification.chats.more', { title: titled, count: items.length - 1 }),
    target: {
      type: 'teler',
      path: latest ? `/chat/${latest.id}` : '/',
      organizationId: latest?.organizationId ?? null,
    },
  }
}

function alertTitle(item: AlertEvent, t: Translate): string {
  if (item.kind === 'back_to_normal')
    return t('notification.alerts.backToNormal', { agent: item.agentLabel })
  return item.isOwner || !item.ownerName
    ? t('notification.alerts.opened', { agent: item.agentLabel })
    : t('notification.alerts.openedColleague', { agent: item.agentLabel, owner: item.ownerName })
}

function composeAlerts(
  items: AlertEvent[],
  t: Translate,
  language: SupportedLanguage
): ComposedNotification {
  // The latest alert is the one to open.
  const latest = items[items.length - 1]
  const [only] = items
  const target: NotificationTarget = {
    type: 'teler',
    path: latest?.targetPath ?? '/',
    organizationId: latest?.organizationId ?? null,
  }
  if (only && items.length === 1) {
    const weekday = new Intl.DateTimeFormat(language, { weekday: 'long' }).format(
      new Date(only.openedAt)
    )
    return {
      kind: 'alerts',
      title: alertTitle(only, t),
      body:
        only.kind === 'back_to_normal'
          ? t('notification.alerts.backToNormalBody', { weekday, title: only.title })
          : only.title,
      target,
    }
  }
  const agents = [...new Set(items.map((item) => item.agentLabel))]
  const [first = '', second = ''] = agents
  return {
    kind: 'alerts',
    title: t('notification.alerts.title', { count: items.length }),
    body:
      agents.length > 2
        ? t('notification.alerts.more', { first, second, count: agents.length - 2 })
        : agents.length === 2
          ? t('notification.alerts.two', { first, second })
          : first,
    target,
  }
}

/** The sentence of one notice in Teler, by its type; the server's title is the subject. */
function inboxTitle(item: InboxEvent, t: Translate): string {
  const agent = item.agentLabel ?? t('notification.inbox.agent')
  switch (item.type) {
    case 'agent_completed':
      return t('notification.inbox.agentCompleted', { agent })
    case 'agent_failed':
      return t('notification.inbox.agentFailed', { agent })
    case 'schedule_needs_approval':
    case 'schedule_held':
    case 'schedule_needs_run':
    case 'dashboard_needs_approval':
      return t('notification.inbox.needsApproval', { title: item.title })
    case 'schedule_run_failed':
      return t('notification.inbox.scheduleRunFailed', { title: item.title })
    case 'schedule_stopped':
    case 'schedule_input_stopped':
      return t('notification.inbox.scheduleStopped', { title: item.title })
    case 'schedule_spend_expiring':
      return t('notification.inbox.scheduleSpendExpiring', { title: item.title })
    case 'access_requested':
      return t('notification.inbox.accessRequested')
    case 'access_request_decided':
      return t('notification.inbox.accessDecided')
    case 'project_role_requested':
      return t('notification.inbox.roleRequested')
    case 'project_role_granted':
      return t('notification.inbox.roleGranted')
    case 'connector_made_private':
      return t('notification.inbox.connectorPrivate')
    default:
      return item.title
  }
}

function composeInbox(items: InboxEvent[], t: Translate): ComposedNotification {
  // The latest notice is the one to open.
  const latest = items[items.length - 1]
  const target: NotificationTarget = {
    type: 'teler',
    path: latest?.targetPath ?? '/',
    organizationId: latest?.organizationId ?? null,
  }
  const [only] = items
  if (only && items.length === 1) {
    // Teler stores a neutral, type-like title and leaves the wording to each client, so only
    // the body is ever added as detail; a sentence built from the type already names its subject.
    return { kind: 'inbox', title: inboxTitle(only, t), body: only.body ?? '', target }
  }
  const titles = [...new Set(items.map((item) => inboxTitle(item, t)))]
  const [first = '', second = ''] = titles
  return {
    kind: 'inbox',
    title: t('notification.inbox.title', { count: items.length }),
    body:
      titles.length > 2
        ? t('notification.inbox.more', { first, second, count: titles.length - 2 })
        : titles.join(' · '),
    target,
  }
}

/** One notification for a group of events of the same kind. */
export function composeNotification(
  kind: NotificationKind,
  items: NotificationEvent[],
  t: Translate,
  language: SupportedLanguage = 'en'
): ComposedNotification {
  if (kind === 'files')
    return composeFiles(
      items.filter((item): item is FileReadyEvent => item.kind === 'file-ready'),
      t
    )
  if (kind === 'folders')
    return composeFolders(
      items.filter((item): item is FolderSyncedEvent => item.kind === 'folder-synced'),
      t
    )
  if (kind === 'problems')
    return composeProblems(
      items.filter((item): item is FolderAttentionEvent => item.kind === 'folder-attention'),
      t
    )
  if (kind === 'alerts')
    return composeAlerts(
      items.filter(
        (item): item is AlertEvent => item.kind === 'opened' || item.kind === 'back_to_normal'
      ),
      t,
      language
    )
  if (kind === 'inbox')
    return composeInbox(
      items.filter((item): item is InboxEvent => item.kind === 'inbox'),
      t
    )
  return composeChats(
    items.filter((item): item is ChatFinishedEvent => item.kind === 'chat-finished'),
    t
  )
}
