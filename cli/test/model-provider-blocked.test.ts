import { describe, expect, it } from 'bun:test'
import { main } from '../src/index'

const CHAT = 'chat_01m2mgs69ge8nvmkdg6924cgg9'

/** `teler send` to an organization whose AI is off, with the 409 body the server returns. */
async function send(body: unknown, json = false) {
  let stderr = ''
  let stdout = ''
  const exitCode = await main(['send', '--chat', CHAT, ...(json ? ['--json'] : []), 'Hello'], {
    env: { TELER_URL: 'https://app.teler.example', TELER_TOKEN: 'example-token' },
    fetch: async () => Response.json(body, { status: 409 }),
    writeOut: (text) => (stdout += text),
    writeErr: (text) => (stderr += text),
  })
  return { exitCode, stderr, stdout }
}

const blocked = (reason: string) => ({
  error: 'Server text the CLI does not echo',
  code: 'MODEL_PROVIDER_BLOCKED',
  reason,
})

describe('a send refused because the organization’s AI is off', () => {
  it('says why and what to do, in the CLI’s own words', async () => {
    const result = await send(blocked('disconnected'))
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toBe(
      'teler: Teler API request failed (409 MODEL_PROVIDER_BLOCKED disconnected)\n' +
        'hint: AI is off in this organization until an owner or admin fixes its AI provider in the Teler app (Agent controls › Models). Nothing was sent.\n'
    )
    expect(result.stderr).not.toContain('Server text')
  })

  it('says a reached daily limit needs no fix', async () => {
    const result = await send(blocked('daily_limit_reached'))
    expect(result.stderr).toContain(
      'hint: This organization reached its daily AI limit; AI resumes at 00:00 UTC. Nothing was sent.'
    )
  })

  it('gives the reason and the hint to --json callers', async () => {
    const result = await send(blocked('runners_not_ready'), true)
    const line = JSON.parse(result.stderr.trim() || result.stdout.trim()) as {
      error: { code: string; reason?: string; hint?: string }
    }
    expect(line.error.code).toBe('MODEL_PROVIDER_BLOCKED')
    expect(line.error.reason).toBe('runners_not_ready')
    expect(line.error.hint).toBe(
      'Teler is updating; AI in this organization resumes in a few minutes. Nothing was sent; try again then.'
    )
  })

  it('falls back to a general hint for a reason it does not know, without echoing it', async () => {
    const inherited = await send(blocked('constructor'))
    expect(inherited.stderr).toContain('hint: AI is off in this organization; an owner or admin')
    const result = await send(blocked('Something <else>'))
    expect(result.stderr).toBe(
      'teler: Teler API request failed (409 MODEL_PROVIDER_BLOCKED)\n' +
        'hint: AI is off in this organization; an owner or admin can see why in the Teler app (Agent controls › Models). Nothing was sent.\n'
    )
  })
})
