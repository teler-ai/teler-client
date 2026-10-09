import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'
import type { CredentialStore } from '../src/credentials'

const store: CredentialStore = {
  get: async () => 'token-secret',
  set: async () => undefined,
  delete: async () => undefined,
}

describe('teler command parser', () => {
  it('lists posts with resource-style pagination and project filters', async () => {
    const requests: string[] = []
    let output = ''
    const exitCode = await main(
      [
        'post',
        'list',
        '--org',
        'org_01m2mgs69ge8nvmkdg6924cgg9',
        '--project',
        'proj_01m2mgs69ge8nvmkdg6924cgg9',
        '--limit',
        '5',
        '--cursor',
        'page-token',
        '--json',
      ],
      {
        store,
        writeOut: (text) => {
          output += text
        },
        fetch: async (url) => {
          requests.push(url)
          return Response.json({ items: [], nextCursor: null, hasMore: false })
        },
      }
    )

    expect(exitCode).toBe(0)
    const url = new URL(requests[0] ?? '')
    expect(url.pathname).toBe('/api/post')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      organizationId: 'org_01m2mgs69ge8nvmkdg6924cgg9',
      projectIds: 'proj_01m2mgs69ge8nvmkdg6924cgg9',
      limit: '5',
      cursor: 'page-token',
    })
    expect(JSON.parse(output)).toEqual({ items: [], nextCursor: null, hasMore: false })
  })

  it('gets a dashboard and resolves the active organization when --org is absent', async () => {
    const requests: string[] = []
    const dashboardId = 'dash_01m2mgs69ge8nvmkdg6924cgg9'
    const exitCode = await main(['dashboard', 'get', dashboardId], {
      store,
      writeOut: () => undefined,
      fetch: async (url) => {
        requests.push(url)
        if (requests.length === 1) {
          return Response.json({ activeOrganizationId: 'org_01m2mgs69ge8nvmkdg6924cgg9' })
        }
        return Response.json({
          id: dashboardId,
          name: 'Executive overview',
          description: null,
          widgets: [],
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-20T00:00:00.000Z',
        })
      },
    })

    expect(exitCode).toBe(0)
    expect(requests.map((url) => new URL(url).pathname)).toEqual([
      '/api/teler-cli/me',
      `/api/dashboard/${dashboardId}`,
    ])
  })

  it('identifies unknown post and dashboard list options', async () => {
    let error = ''
    const exitCode = await main(['post', 'list', '--bogus'], {
      store,
      writeOut: () => undefined,
      writeErr: (text) => {
        error += text
      },
    })

    expect(exitCode).toBe(2)
    expect(error).toBe('teler: Unknown option\n')
  })

  it('creates a titled chat before sending the first message', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const chatId = 'chat_01m2mgs69ge8nvmkdg6924cgg9'
    const exitCode = await main(
      [
        'send',
        '--new',
        '--org',
        'org_01m2mgs69ge8nvmkdg6924cgg9',
        '--title',
        'CLI approval test',
        'Create a test table',
      ],
      {
        store,
        writeOut: () => undefined,
        fetch: async (url, init) => {
          requests.push({ url, init })
          if (requests.length === 1) return Response.json({ id: chatId }, { status: 201 })
          return Response.json(
            {
              taskId: 'atask_01m2mgs69ge8nvmkdg6924cgg9',
              messageId: 'msg_01m2mgs69ge8nvmkdg6924cgg9',
            },
            { status: 202 }
          )
        },
      }
    )

    expect(exitCode).toBe(0)
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      organizationId: 'org_01m2mgs69ge8nvmkdg6924cgg9',
      mindsetName: 'default',
      title: 'CLI approval test',
    })
  })

  it('records and resumes one exact approval through the authenticated API', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const chatId = 'chat_01m2mgs69ge8nvmkdg6924cgg9'
    const approvalId = 'approval-1'
    const exitCode = await main(
      [
        'approval',
        'respond',
        chatId,
        approvalId,
        '--org',
        'org_01m2mgs69ge8nvmkdg6924cgg9',
        '--allow',
      ],
      {
        store,
        writeOut: () => undefined,
        fetch: async (url, init) => {
          requests.push({ url, init })
          if (requests.length === 1) {
            return Response.json({
              id: chatId,
              messages: [
                {
                  id: 'msg_01m2mgs69ge8nvmkdg6924cgg8',
                  role: 'user',
                  content: [{ type: 'text', text: 'Create a test table' }],
                  createdAt: '2026-09-18T00:00:00.000Z',
                },
                {
                  id: 'msg_01m2mgs69ge8nvmkdg6924cgg9',
                  role: 'assistant',
                  content: [
                    {
                      type: 'web_approval',
                      approvalId,
                      toolCallId: 'call-write',
                      toolName: 'exampleTool',
                      input: { code: 'write()' },
                      signature: 'signed-approval',
                    },
                  ],
                  createdAt: '2026-09-18T00:00:01.000Z',
                },
              ],
            })
          }
          if (requests.length === 2) return Response.json({ approved: true })
          return new Response(
            'data: {"type":"data-turn-identity","data":{"messageId":"msg_01m2mgs69ge8nvmkdg6924cgg9"}}\n\n' +
              'data: {"type":"data-agent-task","data":{"taskId":"atask_01m2mgs69ge8nvmkdg6924cgg9","messageId":"msg_01m2mgs69ge8nvmkdg6924cgg9"}}\n\n' +
              'data: [DONE]\n\n',
            { headers: { 'Content-Type': 'text/event-stream' } }
          )
        },
      }
    )

    expect(exitCode).toBe(0)
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      `/api/chat/${chatId}`,
      `/api/agent-access/approval/${approvalId}`,
      `/api/chat/${chatId}/message`,
    ])
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      organizationId: 'org_01m2mgs69ge8nvmkdg6924cgg9',
      chatId,
      approved: true,
    })
    const continuation = JSON.parse(String(requests[2]?.init?.body))
    expect(continuation.messages.at(-1)).toMatchObject({
      id: 'msg_01m2mgs69ge8nvmkdg6924cgg9',
      role: 'assistant',
      parts: [
        {
          type: 'tool-exampleTool',
          toolCallId: 'call-write',
          state: 'approval-responded',
          input: { code: 'write()' },
          approval: { id: approvalId, approved: true, signature: 'signed-approval' },
        },
      ],
    })
  })

  it('sends one message to an existing chat through the authenticated API', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    let output = ''

    const exitCode = await main(
      ['send', '--chat', 'chat_01m2mgs69ge8nvmkdg6924cgg9', '--deep', 'Analyze sales'],
      {
        env: { TELER_URL: 'https://app.teler.example' },
        store,
        writeOut: (text) => {
          output += text
        },
        fetch: async (url, init) => {
          requests.push({ url, init })
          return Response.json(
            {
              taskId: 'atask_01m2mgs69ge8nvmkdg6924cgg9',
              messageId: 'msg_01m2mgs69ge8nvmkdg6924cgg9',
            },
            { status: 202 }
          )
        },
      }
    )

    expect(exitCode).toBe(0)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(
      'https://app.teler.example/api/chat/chat_01m2mgs69ge8nvmkdg6924cgg9/message'
    )
    expect(new Headers(requests[0]?.init?.headers).get('Authorization')).toBe('Bearer token-secret')
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      messages: [{ role: 'user', content: 'Analyze sales' }],
      modelSet: 'lite',
      deepAnalysis: true,
    })
    expect(output).toContain('atask_01m2mgs69ge8nvmkdg6924cgg9')
  })

  it('does not delete a stored login when logging out a TELER_TOKEN override', async () => {
    let deleted = false
    const exitCode = await main(['auth', 'logout'], {
      env: { TELER_TOKEN: 'override-secret' },
      store: {
        ...store,
        delete: async () => {
          deleted = true
        },
      },
      fetch: async () => Response.json({ success: true }),
      writeOut: () => undefined,
    })

    expect(exitCode).toBe(0)
    expect(deleted).toBe(false)
  })

  it('streams task content and reports successful completion', async () => {
    let output = ''
    const exitCode = await main(
      ['task', 'watch', 'chat_01m2mgs69ge8nvmkdg6924cgg9', 'atask_01m2mgs69ge8nvmkdg6924cgg9'],
      {
        store,
        writeOut: (text) => {
          output += text
        },
        fetch: async () =>
          new Response(
            [
              'event: content',
              'data: {"fields":[{"type":"text","text":"Analysis complete."}],"done":false}',
              '',
              'event: content',
              'data: {"fields":[],"done":true,"status":"completed"}',
              '',
            ].join('\n'),
            { headers: { 'Content-Type': 'text/event-stream' } }
          ),
      }
    )

    expect(exitCode).toBe(0)
    expect(output).toBe('Analysis complete.\n')
  })

  it('resumes capped task streams from the last content cursor', async () => {
    let output = ''
    let requestCount = 0
    const exitCode = await main(
      ['task', 'watch', 'chat_01m2mgs69ge8nvmkdg6924cgg9', 'atask_01m2mgs69ge8nvmkdg6924cgg9'],
      {
        store,
        writeOut: (text) => {
          output += text
        },
        fetch: async (_url, init) => {
          requestCount += 1
          if (requestCount === 1) {
            expect(new Headers(init?.headers).has('Last-Event-ID')).toBe(false)
            return new Response(
              'event: content\nid: 1\ndata: {"fields":[{"type":"text","text":"Part one. "}],"done":false}\n\n' +
                'event: content\nid: 1\ndata: {"fields":[],"done":false,"reconnect":true}\n\n',
              { headers: { 'Content-Type': 'text/event-stream' } }
            )
          }
          expect(new Headers(init?.headers).get('Last-Event-ID')).toBe('1')
          return new Response(
            'event: content\nid: 2\ndata: {"fields":[{"type":"text","text":"Part two."}],"done":false}\n\n' +
              'event: content\nid: 2\ndata: {"fields":[],"done":true,"status":"completed"}\n\n',
            { headers: { 'Content-Type': 'text/event-stream' } }
          )
        },
      }
    )

    expect(exitCode).toBe(0)
    expect(requestCount).toBe(2)
    expect(output).toBe('Part one. Part two.\n')
  })

  it('returns a failure exit code for failed task streams without echoing server details', async () => {
    let stderr = ''
    const exitCode = await main(
      ['task', 'watch', 'chat_01m2mgs69ge8nvmkdg6924cgg9', 'atask_01m2mgs69ge8nvmkdg6924cgg9'],
      {
        store,
        writeOut: () => undefined,
        writeErr: (text) => {
          stderr += text
        },
        fetch: async () =>
          new Response(
            'event: content\ndata: {"fields":[],"done":true,"status":"failed","error":"secret upstream detail"}\n\n',
            { headers: { 'Content-Type': 'text/event-stream' } }
          ),
      }
    )

    expect(exitCode).toBe(1)
    expect(stderr).toBe('teler: Teler task failed\n')
    expect(stderr).not.toContain('secret upstream detail')
  })

  it('returns a failure exit code for inline stream errors', async () => {
    let stdout = ''
    let stderr = ''
    const exitCode = await main(
      ['send', '--chat', 'chat_01m2mgs69ge8nvmkdg6924cgg9', '--json', 'Analyze sales'],
      {
        store,
        writeOut: (text) => {
          stdout += text
        },
        writeErr: (text) => {
          stderr += text
        },
        fetch: async () =>
          new Response(
            'data: {"type":"error","errorText":"secret upstream detail"}\n\ndata: [DONE]\n\n',
            { headers: { 'Content-Type': 'text/event-stream' } }
          ),
      }
    )

    expect(exitCode).toBe(1)
    expect(stdout).toContain('The Teler turn failed')
    expect(JSON.parse(stderr)).toEqual({
      error: { code: 'TASK_FAILED', message: 'The Teler turn failed', retryable: false },
    })
    expect(`${stdout}${stderr}`).not.toContain('secret upstream detail')
  })

  it('emits only lifecycle metadata for redacted automation', async () => {
    let output = ''
    let requestCount = 0
    const taskId = 'atask_01m2mgs69ge8nvmkdg6924cgg9'
    const exitCode = await main(
      [
        'send',
        '--chat',
        'chat_01m2mgs69ge8nvmkdg6924cgg9',
        '--wait',
        '--json',
        '--metadata-only',
        'Analyze the approved sales export',
      ],
      {
        store,
        writeOut: (text) => {
          output += text
        },
        fetch: async () => {
          requestCount += 1
          if (requestCount === 1) {
            return new Response(
              [
                'data: {"type":"text-delta","delta":"secret analyst response"}',
                '',
                `data: {"type":"data-agent-task","data":{"taskId":"${taskId}","summary":"secret dataset detail"}}`,
                '',
                'data: [DONE]',
                '',
              ].join('\n'),
              { headers: { 'Content-Type': 'text/event-stream' } }
            )
          }
          return new Response(
            [
              'event: content',
              'data: {"fields":[{"type":"text","text":"secret task report"}],"done":false,"status":"secret status","progress":{"detail":"secret progress"}}',
              '',
              'event: content',
              'data: {"fields":[],"done":true,"status":"completed"}',
              '',
            ].join('\n'),
            { headers: { 'Content-Type': 'text/event-stream' } }
          )
        },
      }
    )

    expect(exitCode).toBe(0)
    expect(requestCount).toBe(2)
    expect(
      output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).toEqual([
      { type: 'turn.agent_task', data: { taskId } },
      { type: 'task.update', data: { done: false, failed: false } },
      { type: 'task.update', data: { done: true, status: 'completed', failed: false } },
    ])
    expect(output).not.toContain('secret')
  })

  it('fails closed without echoing malformed inline task identifiers', async () => {
    let stdout = ''
    let stderr = ''
    const exitCode = await main(
      [
        'send',
        '--chat',
        'chat_01m2mgs69ge8nvmkdg6924cgg9',
        '--wait',
        '--json',
        '--metadata-only',
        'Analyze the approved sales export',
      ],
      {
        store,
        writeOut: (text) => {
          stdout += text
        },
        writeErr: (text) => {
          stderr += text
        },
        fetch: async () =>
          new Response(
            [
              'data: {"type":"text-delta","delta":"secret analyst response"}',
              '',
              'data: {"type":"data-agent-task","data":{"taskId":"secret task identifier","summary":"secret malformed metadata"}}',
              '',
              'data: [DONE]',
              '',
            ].join('\n'),
            { headers: { 'Content-Type': 'text/event-stream' } }
          ),
      }
    )

    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(JSON.parse(stderr)).toEqual({
      error: {
        code: 'INVALID_RESPONSE',
        message: 'Teler API returned an invalid task response',
        retryable: false,
      },
    })
    expect(`${stdout}${stderr}`).not.toContain('secret')
  })

  it('fails closed without echoing malformed accepted-task identifiers', async () => {
    let stdout = ''
    let stderr = ''
    const exitCode = await main(
      [
        'send',
        '--chat',
        'chat_01m2mgs69ge8nvmkdg6924cgg9',
        '--json',
        '--metadata-only',
        'Analyze the approved sales export',
      ],
      {
        store,
        writeOut: (text) => {
          stdout += text
        },
        writeErr: (text) => {
          stderr += text
        },
        fetch: async () =>
          Response.json(
            {
              taskId: 'secret malformed task identifier',
              messageId: 'msg_01m2mgs69ge8nvmkdg6924cgg9',
            },
            { status: 202 }
          ),
      }
    )

    expect(exitCode).toBe(1)
    expect(stdout).toBe('')
    expect(JSON.parse(stderr)).toEqual({
      error: {
        code: 'INVALID_RESPONSE',
        message: 'Teler API returned an invalid response',
        retryable: false,
      },
    })
    expect(`${stdout}${stderr}`).not.toContain('secret')
  })

  it('bounds task watches with a sanitized timeout failure', async () => {
    let stderr = ''
    const exitCode = await main(
      [
        'task',
        'watch',
        'chat_01m2mgs69ge8nvmkdg6924cgg9',
        'atask_01m2mgs69ge8nvmkdg6924cgg9',
        '--json',
        '--metadata-only',
        '--timeout',
        '0.01',
      ],
      {
        store,
        writeOut: () => undefined,
        writeErr: (text) => {
          stderr += text
        },
        fetch: async (_url, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('secret abort detail'))
            })
          }),
      }
    )

    expect(exitCode).toBe(1)
    expect(JSON.parse(stderr)).toEqual({
      error: { code: 'TIMEOUT', message: 'Teler operation timed out', retryable: false },
    })
    expect(stderr).not.toContain('secret')
  })

  it('uses TELER_TOKEN without initializing an OS credential store', async () => {
    let storeCreated = false
    const exitCode = await main(['auth', 'status'], {
      env: { TELER_TOKEN: 'automation-token' },
      createStore: () => {
        storeCreated = true
        throw new Error('credential store unavailable')
      },
      fetch: async () =>
        Response.json({
          user: { id: 'usr_01m2mgs69ge8nvmkdg6924cgg9', name: 'Teler User' },
          activeOrganizationId: null,
        }),
      writeOut: () => undefined,
    })

    expect(exitCode).toBe(0)
    expect(storeCreated).toBe(false)
  })
})
