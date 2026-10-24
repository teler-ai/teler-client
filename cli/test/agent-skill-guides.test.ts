import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TELER_SKILL,
  TELER_SKILL_GUIDES,
  renderTelerSkill,
  renderTelerSkillFiles,
} from '../src/agent-setup'
import { main } from '../src/index'

const SKILL_FOLDER = join(import.meta.dir, '..', 'skills', 'teler')
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'teler-skill-guides-'))
  directories.push(directory)
  return directory
}

async function setup(args: string[], home: string) {
  let stdout = ''
  let stderr = ''
  const exitCode = await main(['agent', 'setup', ...args], {
    env: { HOME: home },
    fetch: async () => {
      throw new Error('agent setup must not use the network')
    },
    writeOut: (text) => void (stdout += text),
    writeErr: (text) => void (stderr += text),
  })
  return { exitCode, stdout, stderr }
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length
const linkedGuides = (text: string) =>
  [...text.matchAll(/\]\((references\/[a-z0-9-]+\.md)\)/g)].map((match) => match[1])

/** A single-file skill as `teler agent setup` wrote it before the skill had guides. */
const SINGLE_FILE_SKILL = '---\nname: teler\ndescription: Use Teler.\n---\n\n# Teler CLI\n'

describe('the Teler skill and its guides', () => {
  it('bundles every guide in the skill folder and links each one from SKILL.md', async () => {
    const shipped = (await readdir(join(SKILL_FOLDER, 'references'))).map(
      (name) => `references/${name}`
    )
    expect(Object.keys(TELER_SKILL_GUIDES).sort()).toEqual(shipped.sort())
    expect([...new Set(linkedGuides(TELER_SKILL))].sort()).toEqual(shipped.sort())
    for (const [path, text] of Object.entries(TELER_SKILL_GUIDES)) {
      expect(text).toBe(await readFile(join(SKILL_FOLDER, path), 'utf8'))
      expect(text).toMatch(/^# /)
    }
  })

  it('keeps SKILL.md lean and each guide short', () => {
    const [, , body = ''] = TELER_SKILL.split(/^---$/m)
    expect(words(body)).toBeLessThan(600)
    for (const text of Object.values(TELER_SKILL_GUIDES)) expect(words(text)).toBeLessThan(900)
  })

  it('installs SKILL.md and every guide for Claude Code and Codex, and is unchanged on rerun', async () => {
    const home = await temporary()
    const first = await setup(['--json'], home)
    expect(first.exitCode).toBe(0)
    const { results } = JSON.parse(first.stdout) as {
      results: { agent: string; path: string; action: string; files: string[] }[]
    }
    for (const [index, folder] of [
      join(home, '.claude', 'skills', 'teler'),
      join(home, '.agents', 'skills', 'teler'),
    ].entries()) {
      const files = renderTelerSkillFiles()
      expect(results[index]).toMatchObject({
        path: join(folder, 'SKILL.md'),
        action: 'installed',
        files: files.map(([path]) => join(folder, path)),
      })
      for (const [path, text] of files)
        expect(await readFile(join(folder, path), 'utf8')).toBe(text)
    }
    const again = await setup(['--json'], home)
    expect(again.exitCode).toBe(0)
    expect(
      JSON.parse(again.stdout).results.map((entry: { action: string }) => entry.action)
    ).toEqual(['unchanged', 'unchanged'])
  })

  it('updates a single-file skill it wrote earlier, adding the guides', async () => {
    const home = await temporary()
    const folder = join(home, '.agents', 'skills', 'teler')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'SKILL.md'), renderTelerSkill('0.1.4', SINGLE_FILE_SKILL, {}))
    const result = await setup(['--codex', '--json'], home)
    expect(JSON.parse(result.stdout).results[0].action).toBe('updated')
    for (const [path, text] of renderTelerSkillFiles())
      expect(await readFile(join(folder, path), 'utf8')).toBe(text)
  })

  it('keeps a guide the person changed unless --force, and leaves their own files alone', async () => {
    const home = await temporary()
    const folder = join(home, '.claude', 'skills', 'teler')
    await setup(['--claude'], home)
    const [guide = ''] = Object.keys(TELER_SKILL_GUIDES)
    const notes = join(folder, 'my-notes.md')
    await writeFile(notes, 'Mine.\n')
    expect(JSON.parse((await setup(['--claude', '--json'], home)).stdout).results[0].action).toBe(
      'unchanged'
    )
    await writeFile(join(folder, guide), 'Edited by me.\n')
    const kept = await setup(['--claude', '--json'], home)
    expect(kept.exitCode).toBe(1)
    expect(JSON.parse(kept.stdout).results[0].action).toBe('kept')
    expect(await readFile(join(folder, guide), 'utf8')).toBe('Edited by me.\n')
    const forced = await setup(['--claude', '--force', '--json'], home)
    expect(JSON.parse(forced.stdout).results[0].action).toBe('replaced')
    expect(await readFile(join(folder, guide), 'utf8')).toBe(TELER_SKILL_GUIDES[guide])
    expect(await readFile(notes, 'utf8')).toBe('Mine.\n')
  })

  it('removes a guide only an earlier version of its own skill linked', async () => {
    const home = await temporary()
    const folder = join(home, '.claude', 'skills', 'teler')
    const older = `${SINGLE_FILE_SKILL}\nSee [old](references/retired.md).\n`
    await mkdir(join(folder, 'references'), { recursive: true })
    await writeFile(join(folder, 'references', 'retired.md'), '# Retired\n')
    await writeFile(
      join(folder, 'SKILL.md'),
      renderTelerSkill('0.1.4', older, { 'references/retired.md': '# Retired\n' })
    )
    const result = await setup(['--claude', '--json'], home)
    expect(JSON.parse(result.stdout).results[0].action).toBe('updated')
    await expect(stat(join(folder, 'references', 'retired.md'))).rejects.toThrow()
  })

  it('prints every file under a header with --print, and writes nothing', async () => {
    const home = await temporary()
    const printed = await setup(['--print'], home)
    expect(printed.stdout).toBe(
      renderTelerSkillFiles()
        .map(([path, text]) => `==> ${path} <==\n${text}`)
        .join('\n')
    )
    await expect(stat(join(home, '.claude'))).rejects.toThrow()
  })
})
