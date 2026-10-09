import { expect, it } from 'bun:test'
import { main } from '../src/index'
import type { CredentialStore } from '../src/credentials'

const chatId = 'chat_01m2mgs69ge8nvmkdg6924cgg9'
const taskId = 'atask_01m2mgs69ge8nvmkdg6924cgg9'
const messageId = 'msg_01m2mgs69ge8nvmkdg6924cgg9'
const organizationId = 'org_01m2mgs69ge8nvmkdg6924cgg9'

const store: CredentialStore = {
  get: async () => 'test-token',
  set: async () => undefined,
  delete: async () => undefined,
}

interface ApiRequest {
  path: string
  method: string
  body: unknown
}

async function sendNewChat(modelSetArgs: string[] = []): Promise<ApiRequest[]> {
  const requests: ApiRequest[] = []
  const exitCode = await main(
    [
      'send',
      '--new',
      '--org',
      organizationId,
      '--title',
      'First analysis',
      '--deep',
      ...modelSetArgs,
      'Analyze sales',
    ],
    {
      env: { TELER_URL: 'https://app.teler.example' },
      store,
      writeOut: () => undefined,
      writeErr: (text) => {
        throw new Error(`Unexpected CLI error: ${text}`)
      },
      fetch: async (url, init) => {
        const path = new URL(url).pathname
        const method = init?.method ?? 'GET'
        const body =
          init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown)
        requests.push({ path, method, body })

        if (path === '/api/chat') return Response.json({ id: chatId }, { status: 201 })
        if (path === `/api/chat/${chatId}/message`) {
          return Response.json({ taskId, messageId }, { status: 202 })
        }
        return Response.json({}, { status: 404 })
      },
    }
  )

  expect(exitCode).toBe(0)
  return requests
}

function requestBody(request: ApiRequest | undefined): Record<string, unknown> {
  const body = request?.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Expected a JSON object request body')
  }
  return body as Record<string, unknown>
}

for (const { label, args, modelSet } of [
  { label: 'explicit Pro', args: ['--model-set', 'pro'], modelSet: 'pro' },
  { label: 'explicit Lite', args: ['--model-set', 'lite'], modelSet: 'lite' },
  { label: 'the Profile default', args: [], modelSet: undefined },
] as const) {
  it(`sends ${label} to chat creation and the first message`, async () => {
    const requests = await sendNewChat([...args])

    expect(requests.map(({ path, method }) => [path, method])).toEqual([
      ['/api/chat', 'POST'],
      [`/api/chat/${chatId}/message`, 'POST'],
    ])
    expect(requestBody(requests[0])).toEqual({
      organizationId,
      mindsetName: 'default',
      title: 'First analysis',
      ...(modelSet ? { modelSetOverride: modelSet } : {}),
    })

    const messageBody = requestBody(requests[1])
    expect(messageBody).toMatchObject({
      messages: [{ role: 'user', content: 'Analyze sales' }],
      modelSet: modelSet ?? 'lite',
      deepAnalysis: true,
    })
    expect(Object.keys(messageBody).sort()).toEqual(['deepAnalysis', 'messages', 'modelSet'])
  })
}
