import { expect, test } from 'bun:test'
import { main } from '../src/index'

test('JSON failures are structured, safe, and leave stdout empty', async () => {
  let stdout = ''
  let stderr = ''
  const status = await main(['data', 'list', '--json', '--project', 'invalid'], {
    env: { TELER_TOKEN: 'secret' },
    fetch: async () => {
      throw new Error('must not fetch')
    },
    writeOut: (text) => {
      stdout += text
    },
    writeErr: (text) => {
      stderr += text
    },
  })
  expect(status).toBe(2)
  expect(stdout).toBe('')
  expect(JSON.parse(stderr)).toMatchObject({ error: { code: 'INVALID_INPUT', retryable: false } })
})

test('JSON transport failures expose recovery facts without untrusted provider text', async () => {
  let stderr = ''
  const status = await main(['chat', 'list', '--json'], {
    env: { TELER_TOKEN: 'secret' },
    fetch: async () => {
      throw new Error('https://private.test/?token=secret')
    },
    writeErr: (text) => {
      stderr += text
    },
  })
  expect(status).toBe(1)
  expect(JSON.parse(stderr)).toMatchObject({ error: { code: 'NETWORK', status: 503 } })
  expect(stderr).not.toContain('private.test')
  expect(stderr).not.toContain('secret')
})

test('data command is dispatched through main and preserves pagination', async () => {
  let stdout = ''
  const status = await main(
    [
      'data',
      'list',
      '--json',
      '--project',
      'prj_01m2mgs69ge8nvmkdg6924cgg9',
      '--org',
      'org_01m2mgs69ge8nvmkdg6924cgg9',
    ],
    {
      env: { TELER_TOKEN: 'secret' },
      fetch: async (url) => {
        expect(new URL(url).pathname).toBe('/api/data/tables')
        return Response.json({ tables: [], truncated: false, nextOffset: null })
      },
      writeOut: (text) => {
        stdout += text
      },
    }
  )
  expect(status).toBe(0)
  expect(JSON.parse(stdout)).toEqual({ tables: [], truncated: false, nextOffset: null })
})
