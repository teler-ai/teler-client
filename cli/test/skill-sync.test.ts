import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TELER_SKILL,
  TELER_SKILL_GUIDES,
  renderTelerSkill,
  renderTelerSkillFiles,
} from '../src/agent-setup'
import { syncInstalledSkills, type SkillSyncDeps } from '../src/skill-sync'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'teler-skill-sync-'))
  directories.push(directory)
  return directory
}

async function installAs(folder: string, cliVersion: string): Promise<void> {
  await mkdir(join(folder, 'references'), { recursive: true })
  for (const [file, text] of renderTelerSkillFiles(cliVersion))
    await writeFile(join(folder, file), text)
}

async function sync(argv: string[], home: string, overrides: Partial<SkillSyncDeps> = {}) {
  let stderr = ''
  await syncInstalledSkills(
    argv,
    { env: { HOME: home }, home, interactive: true, currentVersion: '0.2.0', ...overrides },
    (text) => void (stderr += text)
  )
  return stderr
}

describe('keeping the installed Teler skill current', () => {
  it('quietly refreshes copies an older setup wrote, once per CLI version', async () => {
    const home = await temporary()
    const claude = join(home, '.claude', 'skills', 'teler')
    const codex = join(home, '.agents', 'skills', 'teler')
    await installAs(claude, '0.1.0')
    await installAs(codex, '0.1.0')
    // That older version also had a guide this one no longer ships.
    const retired = { ...TELER_SKILL_GUIDES, 'references/retired.md': 'An older guide.\n' }
    const linking = TELER_SKILL.replace(
      '](references/outputs.md)',
      '](references/outputs.md), [Retired](references/retired.md)'
    )
    await writeFile(join(claude, 'references', 'retired.md'), 'An older guide.\n')
    await writeFile(join(claude, 'SKILL.md'), renderTelerSkill('0.1.0', linking, retired))

    expect(await sync(['chat', 'list', '--json'], home)).toBe('')
    for (const folder of [claude, codex])
      for (const [file, text] of renderTelerSkillFiles('0.2.0'))
        expect(await readFile(join(folder, file), 'utf8')).toBe(text)
    await expect(stat(join(claude, 'references', 'retired.md'))).rejects.toThrow()

    // The check ran for 0.2.0; until the next version the CLI does not look again.
    await installAs(codex, '0.1.0')
    expect(await sync(['chat', 'list'], home)).toBe('')
    expect(await readFile(join(codex, 'SKILL.md'), 'utf8')).toBe(renderTelerSkill('0.1.0'))
    expect(await sync(['chat', 'list'], home, { currentVersion: '0.2.1' })).toBe('')
    expect(await readFile(join(codex, 'SKILL.md'), 'utf8')).toBe(renderTelerSkill('0.2.1'))
  })

  it('keeps a copy the person changed and says so once, on a terminal', async () => {
    const home = await temporary()
    const claude = join(home, '.claude', 'skills', 'teler')
    await installAs(claude, '0.1.0')
    const changed = `${renderTelerSkill('0.1.0')}\nMy own notes.\n`
    await writeFile(join(claude, 'SKILL.md'), changed)

    const hint = await sync(['chat', 'list'], home)
    expect(hint).toBe(
      'teler: Kept your changed Teler skill for Claude Code. Run `teler agent setup --force` to replace it with this version.\n'
    )
    expect(await readFile(join(claude, 'SKILL.md'), 'utf8')).toBe(changed)
    expect(await sync(['chat', 'list'], home)).toBe('')
    expect(await readFile(join(claude, 'SKILL.md'), 'utf8')).toBe(changed)
  })

  it('saves the hint for a person: never under --json or without a terminal', async () => {
    const home = await temporary()
    const claude = join(home, '.claude', 'skills', 'teler')
    const codex = join(home, '.agents', 'skills', 'teler')
    await installAs(claude, '0.1.0')
    await installAs(codex, '0.1.0')
    for (const folder of [claude, codex])
      await writeFile(join(folder, 'references', 'outputs.md'), 'My own guide.\n')

    expect(await sync(['watch', '--json'], home)).toBe('')
    expect(await sync(['chat', 'list'], home, { interactive: false })).toBe('')
    expect(await sync(['status'], home)).toBe(
      'teler: Kept your changed Teler skill for Claude Code and Codex. Run `teler agent setup --force` to replace it with this version.\n'
    )
    expect(await sync(['status'], home)).toBe('')
  })

  it('drops a saved hint once the copy is current again', async () => {
    const home = await temporary()
    const claude = join(home, '.claude', 'skills', 'teler')
    await installAs(claude, '0.1.0')
    await writeFile(join(claude, 'SKILL.md'), `${renderTelerSkill('0.1.0')}\nMine.\n`)
    expect(await sync(['status', '--json'], home)).toBe('')
    await installAs(claude, '0.2.0')
    expect(await sync(['status'], home)).toBe('')
  })

  it('leaves alone copies it did not write, newer copies and current ones', async () => {
    const home = await temporary()
    const claude = join(home, '.claude', 'skills', 'teler')
    const codex = join(home, '.agents', 'skills', 'teler')
    await mkdir(claude, { recursive: true })
    const own = '---\nname: teler\ndescription: My own Teler notes.\n---\n\nHello.\n'
    await writeFile(join(claude, 'SKILL.md'), own)
    await installAs(codex, '0.3.0')
    expect(await sync(['chat', 'list'], home)).toBe('')
    expect(await readFile(join(claude, 'SKILL.md'), 'utf8')).toBe(own)
    expect(await readFile(join(codex, 'SKILL.md'), 'utf8')).toBe(renderTelerSkill('0.3.0'))
  })

  it('uses CLAUDE_CONFIG_DIR for Claude Code when it is set', async () => {
    const home = await temporary()
    const config = await temporary()
    const folder = join(config, 'skills', 'teler')
    await installAs(folder, '0.1.0')
    await sync(['chat', 'list'], home, { env: { HOME: home, CLAUDE_CONFIG_DIR: config } })
    expect(await readFile(join(folder, 'SKILL.md'), 'utf8')).toBe(renderTelerSkill('0.2.0'))
  })

  it('does nothing when turned off, for setup itself, the sync daemon or Teler Desktop', async () => {
    const home = await temporary()
    const claude = join(home, '.claude', 'skills', 'teler')
    await installAs(claude, '0.1.0')
    for (const [argv, env] of [
      [['chat', 'list'], { HOME: home, TELER_NO_SKILL_SYNC: '1' }],
      [['agent', 'setup', '--dry-run'], { HOME: home }],
      [['sync', 'daemon'], { HOME: home }],
      [['sync', 'list'], { HOME: home, TELER_SYNC_DAEMON: 'managed' }],
    ] as const) {
      expect(await sync([...argv], home, { env })).toBe('')
      expect(await readFile(join(claude, 'SKILL.md'), 'utf8')).toBe(renderTelerSkill('0.1.0'))
    }
    await expect(stat(join(home, '.local', 'state', 'teler'))).rejects.toThrow()
  })

  it('never fails or slows a command it cannot check', async () => {
    const home = await temporary()
    await mkdir(join(home, '.claude', 'skills', 'teler', 'SKILL.md'), { recursive: true })
    await writeFile(join(home, '.local'), 'not a folder')
    expect(await sync(['chat', 'list'], home)).toBe('')
  })

  it('runs before an ordinary command without touching its output', async () => {
    const home = await temporary()
    const claude = join(home, '.claude', 'skills', 'teler')
    await installAs(claude, '0.0.1')
    const cli = fileURLToPath(new URL('../src/index.ts', import.meta.url))
    const run = Bun.spawn([process.execPath, cli, '--version'], {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: home,
        XDG_STATE_HOME: join(home, 'state'),
        TELER_NO_UPDATE_CHECK: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await run.exited).toBe(0)
    expect(await new Response(run.stdout).text()).toMatch(/^teler \S+\n$/)
    expect(await new Response(run.stderr).text()).toBe('')
    expect(await readFile(join(claude, 'SKILL.md'), 'utf8')).toBe(renderTelerSkill())
    expect(await stat(join(home, 'state', 'teler', 'skill-sync.json'))).toBeDefined()
  })
})
