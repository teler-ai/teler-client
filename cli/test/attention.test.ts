import { describe, expect, it } from 'bun:test'
import { TelerApiClient } from '../src/api'
import {
  AttentionTracker,
  attentionSchema,
  noticeText,
  summarizeAttention,
  watchAttention,
  writeAttention,
  writeAttentionEvent,
  type Attention,
} from '../src/attention'
import type { CredentialStore } from '../src/credentials'
import { main } from '../src/index'

const store: CredentialStore = {
  get: async () => 'token-secret',
  set: async () => undefined,
  delete: async () => undefined,
}
const ORG = 'org_01m2mgs69ge8nvmkdg6924cgg9'
const CHAT = 'chat_01m2mgs69ge8nvmkdg6924cgg9'
const AGENT = 'agent_01m2mgs69ge8nvmkdg6924cgg9'

function attention(overrides: Partial<Attention> = {}): Attention {
  return attentionSchema.parse({
    cursor: '2026-10-16T10:00:00.000Z',
    running: { chats: [], agentRuns: [] },
    waiting: { chats: [] },
    unreadNotifications: [{ organizationId: ORG, count: 0 }],
    finished: { chats: [], agentRuns: [] },
    notifications: [],
    ...overrides,
  })
}

const runningChat = (taskId: string) => ({
  id: CHAT,
  title: 'Sales by region',
  organizationId: ORG,
  projectId: null,
  taskId,
  status: 'running' as const,
  startedAt: null,
})
const finishedChat = (taskId: string) => ({
  id: CHAT,
  title: 'Sales by region',
  organizationId: ORG,
  projectId: null,
  taskId,
  status: 'completed' as const,
  completedAt: '2026-10-16T10:00:05.000Z',
})
const notice = (id: string) => ({
  id,
  organizationId: ORG,
  type: 'agent_completed',
  title: 'Weekly pace',
  body: null,
  agentLabel: 'Weekly pace',
  createdAt: '2026-10-16T10:00:03.000Z',
  targetPath: '/agents',
})

describe('AttentionTracker', () => {
  it('announces nothing at the baseline, then each start, end and notice once', () => {
    const tracker = new AttentionTracker()
    expect(
      tracker.next(attention({ running: { chats: [runningChat('atask_1')], agentRuns: [] } }))
    ).toEqual([])
    expect(tracker.cursor).toBe('2026-10-16T10:00:00.000Z')

    const second = attention({
      cursor: '2026-10-16T10:00:20.000Z',
      running: { chats: [runningChat('atask_2')], agentRuns: [] },
      finished: { chats: [finishedChat('atask_1')], agentRuns: [] },
      notifications: [notice('notif_1')],
    })
    expect(tracker.next(second).map((event) => event.type)).toEqual([
      'chat.started',
      'chat.finished',
      'notification',
    ])
    // The overlap repeats what finished and the notice: nothing is announced twice.
    const third = attention({
      cursor: '2026-10-16T10:00:40.000Z',
      finished: { chats: [finishedChat('atask_1'), finishedChat('atask_2')], agentRuns: [] },
      notifications: [notice('notif_1')],
    })
    expect(tracker.next(third)).toEqual([{ type: 'chat.finished', data: finishedChat('atask_2') }])
  })
})

describe('noticeText', () => {
  it("words a notice by its type rather than showing Teler's neutral title", () => {
    const stored = { type: 'agent_completed', title: 'agent_completed', agentLabel: 'Weekly pace' }
    expect(noticeText(stored)).toBe('Weekly pace finished')
    expect(noticeText({ ...stored, type: 'agent_failed', title: 'agent_failed' })).toBe(
      'Weekly pace failed'
    )
    expect(noticeText({ ...stored, agentLabel: null })).toBe('An Agent finished')
    expect(noticeText({ type: 'schedule_stopped', title: 'Monday report', agentLabel: null })).toBe(
      'The schedule of Monday report stopped'
    )
    expect(
      noticeText({ type: 'access_requested', title: 'Access requested', agentLabel: null })
    ).toBe('Someone asked you for access')
    expect(noticeText({ type: 'brand_new', title: 'Something new', agentLabel: null })).toBe(
      'Something new'
    )
  })

  it('is what watch prints for a new notice', () => {
    let line = ''
    writeAttentionEvent(
      { json: false, metadataOnly: false, write: (text) => (line += text) },
      { type: 'notification', data: { ...notice('notif_1'), title: 'agent_completed' } },
      new Date('2026-10-16T10:00:04.000Z')
    )
    expect(line).toBe('10:00:04\tnotification\tnotif_1\tagent_completed\tWeekly pace finished\n')
  })
})

describe('a turn that stopped for an approval', () => {
  it('shows as waiting for approval, not as completed, in status and watch', () => {
    const waiting = { ...finishedChat('atask_1'), awaitingApproval: true }
    let text = ''
    const output = { json: false, metadataOnly: false, write: (chunk: string) => (text += chunk) }
    writeAttention(output, attention({ waiting: { chats: [waiting] } }))
    expect(text).toBe(
      `Nothing running; 1 chat waiting for you.\nwaiting\tchat\t${CHAT}\tawaiting_approval\tSales by region\n`
    )
    text = ''
    writeAttentionEvent(
      output,
      { type: 'chat.finished', data: waiting },
      new Date('2026-10-16T10:00:06.000Z')
    )
    expect(text).toBe(`10:00:06\tchat.finished\t${CHAT}\tawaiting_approval\tSales by region\n`)
  })
})

describe('summarizeAttention', () => {
  it('says what runs and what waits', () => {
    expect(summarizeAttention(attention())).toBe('Nothing running; nothing waiting for you.')
    expect(
      summarizeAttention(
        attention({
          running: {
            chats: [runningChat('atask_1')],
            agentRuns: [
              {
                id: 'agent_run_1',
                agentId: AGENT,
                agentLabel: 'Weekly pace',
                organizationId: ORG,
                status: 'running',
                startedAt: null,
                createdAt: '2026-10-16T09:59:00.000Z',
              },
            ],
          },
          waiting: { chats: [finishedChat('atask_0')] },
          unreadNotifications: [{ organizationId: ORG, count: 3 }],
        })
      )
    ).toBe('1 chat and 1 Agent running; 1 chat and 3 notifications waiting for you.')
  })
})

describe('teler status, watch, chat seen, agent runs and notifications', () => {
  it('status reads the attention of one organization and prints it', async () => {
    const requests: string[] = []
    let output = ''
    const exitCode = await main(['status', '--org', ORG, '--json'], {
      store,
      writeOut: (text) => {
        output += text
      },
      fetch: async (url) => {
        requests.push(url)
        return Response.json(attention())
      },
    })
    expect(exitCode).toBe(0)
    const url = new URL(requests[0] ?? '')
    expect(url.pathname).toBe('/api/attention')
    expect(url.searchParams.get('organizationId')).toBe(ORG)
    expect(JSON.parse(output)).toEqual(attention())

    let human = ''
    await main(['status'], {
      store,
      writeOut: (text) => {
        human += text
      },
      fetch: async () =>
        Response.json(attention({ waiting: { chats: [finishedChat('atask_0')] } })),
    })
    expect(human).toBe(
      `Nothing running; 1 chat waiting for you.\nwaiting\tchat\t${CHAT}\tcompleted\tSales by region\n`
    )
  })

  it('watch passes the last cursor as since and emits events until it is stopped', async () => {
    const reads = [
      attention({ running: { chats: [runningChat('atask_1')], agentRuns: [] } }),
      attention({
        cursor: '2026-10-16T10:00:20.000Z',
        finished: { chats: [finishedChat('atask_1')], agentRuns: [] },
      }),
    ]
    const requests: string[] = []
    const lines: string[] = []
    const controller = new AbortController()
    const client = new TelerApiClient(
      new URL('https://app.teler.example'),
      'token',
      async (url) => {
        requests.push(url)
        const read = reads.shift()
        if (!read) {
          controller.abort()
          return Response.json(attention({ cursor: '2026-10-16T10:00:40.000Z' }))
        }
        return Response.json(read)
      }
    )
    await watchAttention(
      client,
      { json: true, metadataOnly: false, write: (text) => lines.push(text.trim()) },
      {
        organizationId: ORG,
        intervalMs: 15_000,
        signal: controller.signal,
        sleep: async () => undefined,
        now: () => new Date('2026-10-16T10:00:21.000Z'),
      }
    )
    expect(requests.map((url) => new URL(url).searchParams.get('since'))).toEqual([
      null,
      '2026-10-16T10:00:00.000Z',
      '2026-10-16T10:00:20.000Z',
    ])
    expect(lines.map((line) => JSON.parse(line).type)).toEqual(['status', 'chat.finished'])
  })

  it('chat seen marks the chat, agent runs filters the member runs, notifications lists the inbox', async () => {
    const requests: Array<{ url: string; method: string }> = []
    let output = ''
    const deps = {
      store,
      writeOut: (text: string) => {
        output += text
      },
      fetch: async (url: string, init?: RequestInit) => {
        requests.push({ url, method: init?.method ?? 'GET' })
        if (url.endsWith('/seen'))
          return Response.json({ chatId: CHAT, lastViewedAt: '2026-10-16T10:00:00.000Z' })
        if (url.includes('/api/agent-run'))
          return Response.json({
            runs: [
              {
                id: 'agent_run_1',
                agentId: AGENT,
                status: 'running',
                startedAt: null,
                completedAt: null,
                createdAt: '2026-10-16T09:59:00.000Z',
              },
              {
                id: 'agent_run_2',
                agentId: AGENT,
                status: 'completed',
                startedAt: null,
                completedAt: '2026-10-16T09:50:00.000Z',
                resultSummary: 'Three weeks behind.',
                createdAt: '2026-10-16T09:40:00.000Z',
              },
            ],
          })
        return Response.json({
          notifications: [
            {
              id: 'notif_1',
              type: 'agent_completed',
              // Teler stores a neutral, type-like title and leaves the wording to each client.
              title: 'agent_completed',
              body: null,
              agentLabel: 'Weekly pace',
              read: false,
              createdAt: '2026-10-16T10:00:03.000Z',
            },
          ],
        })
      },
    }
    expect(await main(['chat', 'seen', CHAT], deps)).toBe(0)
    expect(requests.at(-1)).toEqual({
      url: `https://app.teler.ai/api/chat/${CHAT}/seen`,
      method: 'POST',
    })
    expect(output).toBe(`${CHAT} seen at 2026-10-16T10:00:00.000Z.\n`)

    output = ''
    expect(await main(['agent', 'runs', '--org', ORG, '--active', '--json'], deps)).toBe(0)
    expect(new URL(requests.at(-1)?.url ?? '').searchParams.get('organizationId')).toBe(ORG)
    expect(JSON.parse(output).runs.map((run: { id: string }) => run.id)).toEqual(['agent_run_1'])

    output = ''
    expect(await main(['agent', 'runs', '--org', ORG], deps)).toBe(0)
    expect(output).toBe(
      `agent_run_1\trunning\t${AGENT}\t2026-10-16T09:59:00.000Z\t\n` +
        `agent_run_2\tcompleted\t${AGENT}\t2026-10-16T09:40:00.000Z\tThree weeks behind.\n`
    )

    output = ''
    expect(await main(['notifications', '--org', ORG], deps)).toBe(0)
    const url = new URL(requests.at(-1)?.url ?? '')
    expect(url.pathname).toBe('/api/notifications')
    expect(url.searchParams.get('onlyUnread')).toBe('true')
    expect(output).toBe(
      'notif_1\tunread\tagent_completed\t2026-10-16T10:00:03.000Z\tWeekly pace finished\n'
    )
  })

  it('agent runs says why a run skipped what it did after reading data, and what to do', async () => {
    const skipped = (reason: string) => ({
      toolName: 'exploreData',
      capability: null,
      reason,
      summary: 'Use exploreData after reading data',
      at: '2026-10-16T09:41:00.000Z',
    })
    const run = (id: string, triggerType: string, skippedActions: unknown[]) => ({
      id,
      agentId: AGENT,
      status: 'completed',
      startedAt: null,
      completedAt: '2026-10-16T09:50:00.000Z',
      resultSummary: 'Validated; not saved.',
      createdAt: '2026-10-16T09:40:00.000Z',
      triggerType,
      skippedActions,
    })
    let output = ''
    const runs = [
      run('agent_run_1', 'manual', [skipped('untrusted'), skipped('untrusted')]),
      run('agent_run_2', 'schedule', [skipped('untrusted')]),
      run('agent_run_3', 'manual', [skipped('cap')]),
      run('agent_run_4', 'parent', [skipped('untrusted')]),
    ]
    const deps = {
      store,
      writeOut: (text: string) => {
        output += text
      },
      fetch: async () => Response.json({ runs }),
    }

    expect(await main(['agent', 'runs', '--org', ORG], deps)).toBe(0)
    const line = (id: string) =>
      `${id}\tcompleted\t${AGENT}\t2026-10-16T09:40:00.000Z\tValidated; not saved.\n`
    expect(output).toBe(
      line('agent_run_1') +
        '\tSkipped for safety: 2 actions after it read your data. A run started by hand never ' +
        "does these after reading data. After a read, only the Agent's scheduled runs may still " +
        'create or update Files and tables, as approved for the schedule (teler schedule create ' +
        `--agent ${AGENT}); for anything else, ask in a chat, where each step is approved.\n` +
        line('agent_run_2') +
        '\tSkipped for safety: 1 action after it read your data. A run on its own never does ' +
        "these after reading data, except creating or updating Files and tables its schedule's " +
        'approval covers; for anything else, ask in a chat, where each step is approved.\n' +
        line('agent_run_3') +
        line('agent_run_4') +
        '\tSkipped for safety: 1 action after it read your data. A run on its own never does ' +
        'these after reading data; ask for them in a chat, where each step is approved.\n'
    )

    output = ''
    expect(await main(['agent', 'runs', '--org', ORG, '--json'], deps)).toBe(0)
    expect(JSON.parse(output).runs).toEqual(runs)
  })
})
