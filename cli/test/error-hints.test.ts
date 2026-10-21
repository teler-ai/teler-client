import { describe, expect, it } from 'bun:test'
import { createCredentialStore } from '../src/credentials'
import { ApiError, CommandError, jsonError } from '../src/errors'
import { main } from '../src/index'

const ORIGIN = 'https://app.teler.example'
const missingSecretTool = () => {
  throw new Error('Executable not found in $PATH: "secret-tool"')
}

async function login(store: ReturnType<typeof createCredentialStore>, json: boolean) {
  let requests = 0
  let stderr = ''
  const exitCode = await main(['auth', 'login', ...(json ? ['--json'] : [])], {
    env: { TELER_URL: ORIGIN },
    createStore: () => store,
    fetch: async () => {
      requests += 1
      return Response.json({})
    },
    writeOut: () => undefined,
    writeErr: (text) => {
      stderr += text
    },
  })
  return { exitCode, requests, stderr }
}

describe('a Linux host without a system keyring', () => {
  it('names the missing keyring and the two ways around it, for every store call', async () => {
    const store = createCredentialStore('linux', missingSecretTool)
    for (const call of [
      () => store.get(ORIGIN),
      () => store.set(ORIGIN, 'token-secret'),
      () => store.delete(ORIGIN),
    ]) {
      const error: unknown = await call().then(
        () => null,
        (rejection: unknown) => rejection
      )
      expect(jsonError(error)).toEqual({
        error: {
          code: 'CREDENTIAL_STORE_UNAVAILABLE',
          message: 'No system keyring was found (secret-tool is not installed).',
          retryable: false,
          hint: 'Set TELER_CREDENTIAL_STORE=file to keep the sign-in in a private file, or use TELER_TOKEN.',
        },
      })
    }
  })

  it('reports a keyring that refuses to store the sign-in with the same code', async () => {
    const store = createCredentialStore('linux', () => ({ exitCode: 1, stdout: new Uint8Array() }))
    const error: unknown = await store.set(ORIGIN, 'token-secret').then(
      () => null,
      (rejection: unknown) => rejection
    )
    expect(jsonError(error).error).toMatchObject({
      code: 'CREDENTIAL_STORE_UNAVAILABLE',
      hint: expect.stringContaining('TELER_CREDENTIAL_STORE=file'),
    })
    expect(JSON.stringify(jsonError(error))).not.toContain('token-secret')
  })

  it('tells an unreachable keyring service apart from a sign-in that is not stored', async () => {
    const encode = (text: string) => new TextEncoder().encode(text)
    const unreachable = createCredentialStore('linux', () => ({
      exitCode: 1,
      stdout: new Uint8Array(),
      stderr: encode('secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY\n'),
    }))
    const error: unknown = await unreachable.get(ORIGIN).then(
      () => null,
      (rejection: unknown) => rejection
    )
    expect(jsonError(error).error).toMatchObject({
      code: 'CREDENTIAL_STORE_UNAVAILABLE',
      message: 'The system keyring service is not reachable.',
      hint: expect.stringContaining('TELER_CREDENTIAL_STORE=file'),
    })
    expect(JSON.stringify(jsonError(error))).not.toContain('X11')
    const notStored = createCredentialStore('linux', () => ({
      exitCode: 1,
      stdout: new Uint8Array(),
      stderr: encode('(secret-tool:1): GLib-WARNING **: unrelated\n'),
    }))
    expect(await notStored.get(ORIGIN)).toBeNull()
    const login = await (async () => {
      let requests = 0
      await main(['auth', 'login', '--json'], {
        env: { TELER_URL: ORIGIN },
        createStore: () => unreachable,
        fetch: async () => {
          requests += 1
          return Response.json({})
        },
        writeOut: () => undefined,
        writeErr: () => undefined,
      })
      return requests
    })()
    expect(login).toBe(0)
  })

  it('stops before the browser sign-in starts, in JSON and in plain output', async () => {
    const store = createCredentialStore('linux', missingSecretTool)
    const json = await login(store, true)
    expect(json.exitCode).toBe(1)
    expect(json.requests).toBe(0)
    expect(JSON.parse(json.stderr).error).toMatchObject({
      code: 'CREDENTIAL_STORE_UNAVAILABLE',
      hint: expect.stringContaining('TELER_TOKEN'),
    })
    const plain = await login(store, false)
    expect(plain.requests).toBe(0)
    expect(plain.stderr).toBe(
      'teler: No system keyring was found (secret-tool is not installed).\n' +
        'hint: Set TELER_CREDENTIAL_STORE=file to keep the sign-in in a private file, or use TELER_TOKEN.\n'
    )
    expect(plain.stderr).not.toContain('Executable not found')
  })
})

describe('signing in again over an unreadable earlier sign-in', () => {
  it('still starts the browser sign-in', async () => {
    const unreadable = {
      get: async () => {
        throw new Error('Teler CLI credential file is invalid')
      },
      set: async () => undefined,
      delete: async () => undefined,
    }
    let requests = 0
    await main(['auth', 'login', '--json'], {
      env: { TELER_URL: ORIGIN },
      createStore: () => unreadable,
      fetch: async () => {
        requests += 1
        return new Response('{}', { status: 500 })
      },
      writeOut: () => undefined,
      writeErr: () => undefined,
    })
    expect(requests).toBeGreaterThan(0)
  })
})

describe('JSON errors that have a next step', () => {
  const hintOf = (error: unknown) => (jsonError(error).error as { hint?: string }).hint

  it('adds a hint where an action exists and keeps the existing fields', () => {
    const update = new ApiError(
      'This version of the teler CLI is no longer supported.',
      426,
      'CLIENT_UPDATE_REQUIRED'
    )
    expect(jsonError(update).error).toMatchObject({
      code: 'CLIENT_UPDATE_REQUIRED',
      message: 'This version of the teler CLI is no longer supported.',
      status: 426,
      retryable: false,
    })
    expect(hintOf(update)).toContain('teler update')
    expect(hintOf(new ApiError('failed', 403, 'PLAN_REQUIRED'))).toContain('plan')
    expect(hintOf(new ApiError('failed', 402, 'INSUFFICIENT_CREDITS'))).toContain('--max-credits')
    expect(hintOf(new ApiError('failed', 429, undefined, 2000))).toContain('same --idempotency-key')
    expect(
      hintOf(new ApiError('failed', 403, 'CAPABILITY_APPROVAL_REQUIRED', undefined, ['web.search']))
    ).toContain('approve')
    expect(hintOf(new ApiError('failed', 401))).toContain('teler auth login')
    expect(hintOf(new ApiError('failed', 409, 'IDEMPOTENCY_CONFLICT'))).toContain(
      'new --idempotency-key'
    )
    expect(
      hintOf(new CommandError('RUN_FAILED', 'Run failed (budget_exhausted)', 'Raise --max-credits'))
    ).toBe('Raise --max-credits')
  })

  it('adds nothing where no action exists', () => {
    expect(jsonError(new ApiError('failed', 500, 'INTERNAL_ERROR')).error).not.toHaveProperty(
      'hint'
    )
    expect(jsonError(new CommandError('TIMEOUT', 'Waiting timed out')).error).not.toHaveProperty(
      'hint'
    )
  })
})
