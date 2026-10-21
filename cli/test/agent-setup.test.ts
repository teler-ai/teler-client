import { afterEach, describe, expect, it } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TELER_SKILL, renderTelerSkill } from '../src/agent-setup'
import { main } from '../src/index'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'teler-agent-setup-'))
  directories.push(directory)
  return directory
}

async function setup(args: string[], env: Record<string, string>) {
  let stdout = ''
  let stderr = ''
  let requests = 0
  const exitCode = await main(['agent', 'setup', ...args], {
    env,
    fetch: async () => {
      requests += 1
      return Response.json({})
    },
    createStore: () => {
      throw new Error('agent setup must not open the credential store')
    },
    writeOut: (text) => void (stdout += text),
    writeErr: (text) => void (stderr += text),
  })
  return { exitCode, stdout, stderr, requests }
}

describe('teler agent setup', () => {
  it('installs the skill for Claude Code and Codex in the user folders, without network', async () => {
    const home = await temporary()
    const result = await setup(['--json'], { HOME: home })
    expect(result.exitCode).toBe(0)
    expect(result.requests).toBe(0)
    const claude = join(home, '.claude', 'skills', 'teler', 'SKILL.md')
    const codex = join(home, '.agents', 'skills', 'teler', 'SKILL.md')
    expect(JSON.parse(result.stdout)).toEqual({
      skill: 'teler',
      results: [
        { agent: 'claude', path: claude, action: 'installed' },
        { agent: 'codex', path: codex, action: 'installed' },
      ],
    })
    for (const path of [claude, codex])
      expect(await readFile(path, 'utf8')).toBe(renderTelerSkill())
    expect((await setup(['--json'], { HOME: home })).stdout).toContain('"action":"unchanged"')
  })

  it('prints exactly what it writes, one agent or a project at a time', async () => {
    const home = await temporary()
    const project = await temporary()
    const result = await setup(['--codex', '--project', project], { HOME: home })
    const path = join(project, '.agents', 'skills', 'teler', 'SKILL.md')
    expect(result.stdout).toBe(`Installed the Teler skill for Codex: ${path}\n`)
    expect(await stat(path)).toBeDefined()
    const claude = await setup(['--claude', '--project', project], { HOME: home })
    expect(claude.stdout).toContain(join(project, '.claude', 'skills', 'teler', 'SKILL.md'))
    await expect(stat(join(home, '.claude'))).rejects.toThrow()
  })

  it('uses CLAUDE_CONFIG_DIR for Claude Code when it is set', async () => {
    const home = await temporary()
    const config = await temporary()
    const result = await setup(['--claude', '--json'], { HOME: home, CLAUDE_CONFIG_DIR: config })
    expect(JSON.parse(result.stdout).results[0].path).toBe(
      join(config, 'skills', 'teler', 'SKILL.md')
    )
  })

  it('writes nothing with --print or --dry-run', async () => {
    const home = await temporary()
    const printed = await setup(['--print'], { HOME: home })
    expect(printed.stdout).toBe(renderTelerSkill())
    const planned = await setup(['--dry-run', '--json'], { HOME: home })
    expect(
      JSON.parse(planned.stdout).results.map((entry: { action: string }) => entry.action)
    ).toEqual(['would install', 'would install'])
    await expect(stat(join(home, '.claude'))).rejects.toThrow()
    await expect(stat(join(home, '.agents'))).rejects.toThrow()
  })

  it('updates its own earlier copy but keeps a copy the person changed unless --force', async () => {
    const home = await temporary()
    const path = join(home, '.claude', 'skills', 'teler', 'SKILL.md')
    await mkdir(join(home, '.claude', 'skills', 'teler'), { recursive: true })
    await writeFile(path, renderTelerSkill('0.0.1'))
    expect((await setup(['--claude', '--json'], { HOME: home })).stdout).toContain(
      '"action":"updated"'
    )
    expect(await readFile(path, 'utf8')).toBe(renderTelerSkill())

    await writeFile(path, `${renderTelerSkill()}\nMy own notes.\n`)
    const kept = await setup(['--claude', '--json'], { HOME: home })
    expect(kept.exitCode).toBe(1)
    expect(JSON.parse(kept.stdout).results[0].action).toBe('kept')
    expect(JSON.parse(kept.stderr).error).toMatchObject({
      code: 'SKILL_CHANGED',
      hint: expect.stringContaining('--force'),
    })
    expect(await readFile(path, 'utf8')).toContain('My own notes.')

    const forced = await setup(['--claude', '--force', '--json'], { HOME: home })
    expect(forced.exitCode).toBe(0)
    expect(await readFile(path, 'utf8')).toBe(renderTelerSkill())
  })

  it('ships a valid, lean Agent Skills file', () => {
    const [, frontmatter = '', body = ''] = TELER_SKILL.split(/^---$/m)
    expect(frontmatter).toMatch(/^name: teler$/m)
    const description = /^description: (.+)$/m.exec(frontmatter)?.[1] ?? ''
    expect(description.length).toBeGreaterThan(0)
    expect(description.length).toBeLessThanOrEqual(1024)
    expect(body.split(/\s+/).length).toBeLessThan(700)
    expect(renderTelerSkill()).toMatch(/^---\nname: teler\n/)
  })

  it('is suggested once after a successful sign-in, never installed by it', async () => {
    const home = await temporary()
    const device = join(home, 'device.json')
    await writeFile(
      device,
      JSON.stringify({
        version: 1,
        clientId: 'teler-cli',
        deviceCode: 'seeded-device-code-0123456789abcdef',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      { mode: 0o600 }
    )
    await chmod(device, 0o600)
    let stdout = ''
    const exitCode = await main(['auth', 'login', '--device-file', device], {
      env: { HOME: home, TELER_URL: 'https://app.teler.example' },
      store: { get: async () => null, set: async () => undefined, delete: async () => undefined },
      fetch: async (url) =>
        new URL(url).pathname === '/api/teler-cli/config'
          ? Response.json({
              version: 1,
              clientId: 'teler-cli',
              deviceAuthorizationEndpoint: '/api/auth/device/code',
              deviceTokenEndpoint: '/api/auth/device/token',
              sessionEndpoint: '/api/teler-cli/me',
            })
          : Response.json({
              access_token: 'session-token',
              token_type: 'Bearer',
              expires_in: 60,
              scope: 'openid profile',
            }),
      writeOut: (text) => void (stdout += text),
      writeErr: () => undefined,
    })
    expect(exitCode).toBe(0)
    expect(stdout.match(/teler agent setup/g)).toHaveLength(1)
    await expect(stat(join(home, '.claude'))).rejects.toThrow()
  })

  it('rejects unknown flags and a missing project folder', async () => {
    const home = await temporary()
    expect((await setup(['--everything'], { HOME: home })).exitCode).toBe(2)
    expect((await setup(['--project', join(home, 'missing')], { HOME: home })).exitCode).toBe(2)
  })
})
