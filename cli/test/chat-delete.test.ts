import { describe, expect, it } from 'bun:test'
import type { CredentialStore } from '../src/credentials'
import { main } from '../src/index'

const chatId = 'chat_01m2mgs69ge8nvmkdg6924cgg9'
const store: CredentialStore = {
  get: async () => 'token-secret',
  set: async () => undefined,
  delete: async () => undefined,
}

async function remove(args: string[], respond: () => Response) {
  const requests: { url: string; method: string }[] = []
  let stdout = ''
  let stderr = ''
  const exitCode = await main(['chat', 'delete', ...args], {
    env: { TELER_URL: 'https://app.teler.example' },
    store,
    fetch: async (url, init) => {
      requests.push({ url, method: init?.method ?? 'GET' })
      return respond()
    },
    writeOut: (text) => void (stdout += text),
    writeErr: (text) => void (stderr += text),
  })
  return { exitCode, requests, stdout, stderr }
}

describe('teler chat delete', () => {
  it('needs --yes before it sends anything', async () => {
    const result = await remove([chatId, '--json'], () => new Response(null, { status: 204 }))
    expect(result.exitCode).toBe(2)
    expect(result.requests).toEqual([])
    expect(JSON.parse(result.stderr).error).toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('--yes'),
    })
  })

  it('permanently deletes one chat, named by ID or URL', async () => {
    for (const reference of [chatId, `https://app.teler.example/chat/${chatId}`]) {
      const result = await remove(
        [reference, '--yes', '--json'],
        () => new Response(null, { status: 204 })
      )
      expect(result.exitCode).toBe(0)
      expect(result.requests).toEqual([
        { url: `https://app.teler.example/api/chat/${chatId}?permanent=true`, method: 'DELETE' },
      ])
      expect(JSON.parse(result.stdout)).toEqual({ chatId, deleted: true })
    }
    const plain = await remove([chatId, '--yes'], () => new Response(null, { status: 204 }))
    expect(plain.stdout).toBe(`Deleted chat ${chatId}.\n`)
  })

  it('explains a server that does not let the CLI delete chats yet', async () => {
    const result = await remove([chatId, '--yes', '--json'], () =>
      Response.json({ error: 'Forbidden' }, { status: 403 })
    )
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr).error).toMatchObject({
      code: 'UNSUPPORTED_BY_SERVER',
      status: 403,
      message: 'This Teler server does not let the CLI delete chats yet.',
      hint: 'Delete the chat in the Teler app.',
    })
  })

  it("refuses someone else's chat in plain words", async () => {
    const result = await remove([chatId, '--yes'], () =>
      Response.json({ error: 'Access denied', code: 'ACCESS_DENIED' }, { status: 403 })
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe('teler: You can only delete your own chats.\n')
  })
})
