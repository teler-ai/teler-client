import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTranslator } from '../../src/main/i18n'
import { NotificationBatcher } from '../../src/main/notifications/batcher'
import { composeNotification } from '../../src/main/notifications/compose'

const t = createTranslator('en')
const file = (path: string, updated = false, documentId: string | null = `doc_${path}`) => ({
  kind: 'file-ready' as const,
  folderId: 'reg_1',
  folderName: 'Reports',
  organizationId: 'org_1',
  path,
  documentId,
  updated,
})

describe('notification copy and targets', () => {
  it('names a single ready file and opens it', () => {
    expect(composeNotification('files', [file('sales.csv')], t)).toEqual({
      kind: 'files',
      title: 'sales.csv is ready in Teler',
      body: 'Reports',
      target: { type: 'teler', path: '/data?file=doc_sales.csv', organizationId: 'org_1' },
    })
    expect(composeNotification('files', [file('sales.csv', true)], t).title).toBe(
      'sales.csv was updated in Teler'
    )
  })

  it('groups files, counting new and updated, and opens the data page', () => {
    const grouped = composeNotification(
      'files',
      [file('a.csv'), file('b.csv'), file('c.csv', true)],
      t
    )
    expect(grouped).toMatchObject({
      title: '3 files ready in Teler',
      body: '2 new · 1 updated · Reports',
      target: { type: 'teler', path: '/data', organizationId: 'org_1' },
    })
  })

  it('announces a synced folder, problems and finished chats', () => {
    expect(
      composeNotification(
        'folders',
        [
          {
            kind: 'folder-synced',
            folderId: 'reg_1',
            folderName: 'Q3',
            organizationId: 'org_2',
            files: 140,
          },
        ],
        t
      )
    ).toEqual({
      kind: 'folders',
      title: 'Q3 is in Teler',
      body: '140 files synced',
      target: { type: 'teler', path: '/data', organizationId: 'org_2' },
    })
    expect(
      composeNotification(
        'problems',
        [
          {
            kind: 'folder-attention',
            folderId: 'reg_1',
            folderName: 'Q3',
            organizationId: 'org_2',
            problems: 2,
          },
        ],
        t
      )
    ).toEqual({
      kind: 'problems',
      title: 'Files need attention',
      body: '2 files in Q3 need attention',
      target: { type: 'synced-folders' },
    })
    const chats = composeNotification(
      'chats',
      [
        { kind: 'chat-finished', id: 'chat_1', title: 'Q3 revenue', organizationId: 'org_1' },
        { kind: 'chat-finished', id: 'chat_2', title: null, organizationId: 'org_1' },
      ],
      t
    )
    expect(chats).toEqual({
      kind: 'chats',
      title: 'Teler finished 2 chats',
      body: 'Q3 revenue and 1 more',
      target: { type: 'teler', path: '/chat/chat_2', organizationId: 'org_1' },
    })
    expect(
      composeNotification(
        'chats',
        [{ kind: 'chat-finished', id: 'chat_1', title: 'Q3 revenue', organizationId: 'org_1' }],
        t
      )
    ).toMatchObject({
      title: 'Teler finished',
      body: 'Q3 revenue',
      target: { path: '/chat/chat_1' },
    })
  })
})

describe('notification batching', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function batcher() {
    const delivered: Array<{ kind: string; count: number }> = []
    const value = new NotificationBatcher(
      { files: 10_000, folders: 2_000, problems: 10_000, chats: 2_000, alerts: 2_000 },
      60_000,
      (kind, items) => delivered.push({ kind, count: items.length })
    )
    return { value, delivered }
  }

  it('waits for a quiet moment, then delivers one grouped notification', () => {
    const { value, delivered } = batcher()
    value.add('files', file('a.csv'))
    vi.advanceTimersByTime(5_000)
    value.add('files', file('b.csv'))
    vi.advanceTimersByTime(9_000)
    expect(delivered).toEqual([])
    vi.advanceTimersByTime(1_000)
    expect(delivered).toEqual([{ kind: 'files', count: 2 }])
  })

  it('never holds a busy stream longer than the maximum wait', () => {
    const { value, delivered } = batcher()
    for (let second = 0; second < 70; second += 5) {
      value.add('files', file(`f${second}.csv`))
      vi.advanceTimersByTime(5_000)
    }
    expect(delivered[0]).toEqual({ kind: 'files', count: 12 })
  })

  it('keeps kinds apart and drops what is pending when cleared', () => {
    const { value, delivered } = batcher()
    value.add('files', file('a.csv'))
    value.add('chats', { kind: 'chat-finished', id: 'c', title: null, organizationId: 'o' })
    vi.advanceTimersByTime(2_000)
    expect(delivered).toEqual([{ kind: 'chats', count: 1 }])
    value.clear()
    vi.advanceTimersByTime(60_000)
    expect(delivered).toHaveLength(1)
  })
})
