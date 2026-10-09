import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'
import type { CredentialStore } from '../src/credentials'

const store: CredentialStore = {
  get: async () => 'token-secret',
  set: async () => undefined,
  delete: async () => undefined,
}
const chatId = 'chat_01m2mgs69ge8nvmkdg6924cgg9'
const steerId = 'armsg_01m2mgs69ge8nvmkdg6924cgg9'

describe('teler steer', () => {
  it('sends the text to the running turn of a chat', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    let output = ''
    const exitCode = await main(['steer', chatId, 'Focus on EU', '--json'], {
      store,
      writeOut: (text) => {
        output += text
      },
      fetch: async (url, init) => {
        requests.push({ url, body: JSON.parse(String(init?.body)) })
        return Response.json({ status: 'accepted', steerId }, { status: 202 })
      },
    })

    expect(exitCode).toBe(0)
    expect(new URL(requests[0]!.url).pathname).toBe(`/api/chat/${chatId}/steer`)
    expect(requests[0]!.body).toMatchObject({ text: 'Focus on EU' })
    expect(typeof (requests[0]!.body as { idempotencyKey?: unknown }).idempotencyKey).toBe('string')
    expect(JSON.parse(output)).toEqual({ type: 'steer.accepted', data: { chatId, steerId } })
  })

  it('tells the user to send a new message when no turn is running', async () => {
    let errors = ''
    const exitCode = await main(['steer', chatId, 'Too late'], {
      store,
      writeErr: (text) => {
        errors += text
      },
      fetch: async () =>
        Response.json({ error: 'No running turn', code: 'STEER_CLOSED' }, { status: 409 }),
    })

    expect(exitCode).toBe(1)
    expect(errors).toContain('No running turn of yours to steer')
  })

  it('requires a chat and one message', async () => {
    const exitCode = await main(['steer', chatId], { store, writeErr: () => undefined })
    expect(exitCode).toBe(2)
  })
})
