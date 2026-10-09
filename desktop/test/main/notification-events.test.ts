import { describe, expect, it } from 'vitest'
import { chatListSchema, nextChatState } from '../../src/main/notifications/chat-events'
import { nextSyncState, type SyncRegistrationInput } from '../../src/main/notifications/sync-events'

type FileInput = SyncRegistrationInput['files'][number]

function folder(id: string, files: FileInput[]): SyncRegistrationInput {
  return { id, localPath: `/Users/ana/${id}`, organizationId: 'org_1', files }
}
const ready = (relativePath: string, revision = 'r1', documentIds = ['doc_1']): FileInput => ({
  relativePath,
  status: 'ready',
  revision,
  documentIds,
})
const pending = (relativePath: string): FileInput => ({ relativePath, status: 'pending' })

describe('sync notification events', () => {
  it('announces nothing for what was already there at startup', () => {
    const { events } = nextSyncState(null, [folder('Reports', [ready('a.csv'), pending('b.csv')])])
    expect(events).toEqual([])
  })

  it('announces a folder once its first sync completes, not each of its files', () => {
    const first = nextSyncState(null, [])
    const uploading = nextSyncState(first.state, [
      folder('Q3', [
        ready('a.csv'),
        pending('b.csv'),
        { relativePath: '.env', status: 'excluded' },
      ]),
    ])
    expect(uploading.events).toEqual([])
    const done = nextSyncState(uploading.state, [
      folder('Q3', [ready('a.csv'), ready('b.csv'), { relativePath: '.env', status: 'excluded' }]),
    ])
    expect(done.events).toEqual([
      {
        kind: 'folder-synced',
        folderId: 'Q3',
        folderName: 'Q3',
        organizationId: 'org_1',
        files: 2,
      },
    ])
    // Afterwards the folder is synced: no repeat.
    expect(
      nextSyncState(done.state, [folder('Q3', [ready('a.csv'), ready('b.csv')])]).events
    ).toEqual([])
  })

  it('announces a folder added while running, already synced at first sight, once', () => {
    const before = nextSyncState(null, []).state
    const seen = nextSyncState(before, [folder('Q4', [ready('a.csv')])])
    expect(seen.events).toMatchObject([{ kind: 'folder-synced', folderId: 'Q4', files: 1 }])
    expect(nextSyncState(seen.state, [folder('Q4', [ready('a.csv')])]).events).toEqual([])
  })

  it('announces new and updated files of a synced folder', () => {
    const synced = nextSyncState(null, [folder('Reports', [ready('a.csv', 'r1')])]).state
    const changed = nextSyncState(synced, [
      folder('Reports', [
        ready('a.csv', 'r2', ['doc_a']),
        ready('new.csv', 'r1', ['doc_new']),
        pending('later.csv'),
      ]),
    ])
    expect(changed.events).toEqual([
      {
        kind: 'file-ready',
        folderId: 'Reports',
        folderName: 'Reports',
        organizationId: 'org_1',
        path: 'a.csv',
        documentId: 'doc_a',
        updated: true,
      },
      {
        kind: 'file-ready',
        folderId: 'Reports',
        folderName: 'Reports',
        organizationId: 'org_1',
        path: 'new.csv',
        documentId: 'doc_new',
        updated: false,
      },
    ])
  })

  it('notices an edit by its content, even when no in-between state was seen', () => {
    const synced = nextSyncState(null, [
      folder('Reports', [{ ...ready('a.csv', 'same'), hash: 'h1' }]),
    ]).state
    const { events } = nextSyncState(synced, [
      folder('Reports', [{ ...ready('a.csv', 'same', ['doc_a']), hash: 'h2' }]),
    ])
    expect(events).toMatchObject([{ kind: 'file-ready', path: 'a.csv', updated: true }])
  })

  it('links a file only when it became exactly one document', () => {
    const synced = nextSyncState(null, [folder('Reports', [ready('a.csv')])]).state
    const { events } = nextSyncState(synced, [
      folder('Reports', [ready('a.csv'), ready('book.xlsx', 'r1', ['doc_x', 'doc_sheet'])]),
    ])
    expect(events).toMatchObject([{ path: 'book.xlsx', documentId: null }])
  })

  it('announces new problems once, not waiting files', () => {
    const synced = nextSyncState(null, [folder('Reports', [ready('a.csv')])]).state
    const waiting = nextSyncState(synced, [
      folder('Reports', [ready('a.csv'), { relativePath: 'b.csv', status: 'retrying' }]),
    ])
    expect(waiting.events).toEqual([])
    const failed = nextSyncState(waiting.state, [
      folder('Reports', [ready('a.csv'), { relativePath: 'b.csv', status: 'failed' }]),
    ])
    expect(failed.events).toEqual([
      {
        kind: 'folder-attention',
        folderId: 'Reports',
        folderName: 'Reports',
        organizationId: 'org_1',
        problems: 1,
      },
    ])
    expect(
      nextSyncState(failed.state, [
        folder('Reports', [ready('a.csv'), { relativePath: 'b.csv', status: 'failed' }]),
      ]).events
    ).toEqual([])
  })
})

describe('chat notification events', () => {
  const chat = (id: string, hasActiveTask: boolean, title = `Chat ${id}`) => ({
    id,
    title,
    hasActiveTask,
    organizationId: 'org_1',
  })

  it('announces chats whose turn finished since the last look', () => {
    const baseline = nextChatState(null, [chat('a', true), chat('b', false)])
    expect(baseline.finished).toEqual([])
    const next = nextChatState(baseline.running, [chat('a', false), chat('b', true)])
    expect(next.finished).toEqual([{ id: 'a', title: 'Chat a', organizationId: 'org_1' }])
    expect([...next.running.keys()]).toEqual(['b'])
  })

  it('ignores chats that disappeared and untitled chats get no title', () => {
    const baseline = nextChatState(null, [chat('a', true), chat('b', true, '')])
    const next = nextChatState(baseline.running, [chat('b', false, '')])
    expect(next.finished).toEqual([{ id: 'b', title: null, organizationId: 'org_1' }])
  })

  it('reads a chat list that includes a chat without an organization', () => {
    const parsed = chatListSchema.safeParse({
      chats: [chat('a', false), { ...chat('b', true), organizationId: null, lastMessage: 'hi' }],
      total: 2,
    })
    expect(parsed.success).toBe(true)
    const baseline = nextChatState(null, parsed.data?.chats ?? [])
    const next = nextChatState(baseline.running, [{ ...chat('b', false), organizationId: null }])
    expect(next.finished).toEqual([{ id: 'b', title: 'Chat b', organizationId: null }])
  })
})
