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

function composeChats(items: ChatFinishedEvent[], t: Translate): ComposedNotification {
  // The latest chat is the one to open.
  const latest = items[items.length - 1]
  const titled = items.find((item) => item.title)?.title ?? t('notification.chat.untitled')
  return {
    kind: 'chats',
    title:
      items.length === 1
        ? t('notification.chat.title')
        : t('notification.chats.title', { count: items.length }),
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
  return composeChats(
    items.filter((item): item is ChatFinishedEvent => item.kind === 'chat-finished'),
    t
  )
}
