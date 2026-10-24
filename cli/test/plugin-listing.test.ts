import { describe, expect, it } from 'bun:test'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { version } from '../package.json'

// The plugin folder at the repository root lists this package's skill in the Claude Code and
// Codex plugin directories. It ships a copy of `skills/teler`, which must not drift.
const PACKAGE_SKILL = join(import.meta.dir, '..', 'skills', 'teler')
const PLUGIN = join(import.meta.dir, '..', '..', 'plugins', 'teler')

async function files(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)))
    .sort()
}

const manifest = async (path: string) =>
  JSON.parse(await readFile(join(PLUGIN, path), 'utf8')) as Record<string, unknown> & {
    interface?: Record<string, unknown>
  }

describe('the Claude Code and Codex plugin', () => {
  it('ships exactly the skill files `teler agent setup` installs', async () => {
    const skill = join(PLUGIN, 'skills', 'teler')
    const shipped = await files(PACKAGE_SKILL)
    expect(await files(skill)).toEqual(shipped)
    for (const path of shipped)
      expect(
        await readFile(join(skill, path), 'utf8'),
        `plugins/teler/skills/teler/${path} differs; run: cp -R cli/skills/teler/. plugins/teler/skills/teler/`
      ).toBe(await readFile(join(PACKAGE_SKILL, path), 'utf8'))
  })

  it('describes the same plugin, at the CLI version, in both manifests', async () => {
    const claude = await manifest('.claude-plugin/plugin.json')
    const codex = await manifest('.codex-plugin/plugin.json')
    for (const entry of [claude, codex]) {
      expect(entry).toMatchObject({ name: 'teler', version, license: 'Apache-2.0' })
      expect(entry.description).toBe(claude.description)
    }
    expect(codex.skills).toBe('./skills/')
  })

  it('keeps the Codex listing within the directory limits, with assets that exist', async () => {
    const listing = (await manifest('.codex-plugin/plugin.json')).interface ?? {}
    expect(String(listing.displayName).length).toBeLessThanOrEqual(30)
    expect(String(listing.shortDescription).length).toBeLessThanOrEqual(30)
    expect(String(listing.longDescription).length).toBeLessThanOrEqual(4000)
    const prompts = listing.defaultPrompt as string[]
    expect(prompts.length).toBeLessThanOrEqual(3)
    for (const prompt of prompts) expect(prompt.length).toBeLessThanOrEqual(128)
    for (const key of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL'])
      expect(String(listing[key])).toMatch(/^https:\/\/teler\.ai(\/[a-z]+)?$/)
    for (const key of ['logo', 'composerIcon']) {
      expect(String(listing[key])).toStartWith('./assets/')
      expect((await stat(join(PLUGIN, String(listing[key])))).size).toBeLessThan(5 * 1024 * 1024)
    }
  })

  it('has a README the directories accept, and no email address anywhere', async () => {
    const readme = await readFile(join(PLUGIN, 'README.md'), 'utf8')
    expect(readme.replace(/```[\s\S]*?```/g, '').split(/\s+/).length).toBeGreaterThan(40)
    for (const path of await files(PLUGIN)) {
      if (path.endsWith('.png')) continue
      expect(await readFile(join(PLUGIN, path), 'utf8')).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    }
  })
})
