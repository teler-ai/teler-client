import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { version } from '../package.json'
import skill from '../skills/teler/SKILL.md' with { type: 'text' }
import agentsGuide from '../skills/teler/references/agents-and-chats.md' with { type: 'text' }
import authGuide from '../skills/teler/references/auth-and-access.md' with { type: 'text' }
import dataGuide from '../skills/teler/references/data-and-queries.md' with { type: 'text' }
import schedulesGuide from '../skills/teler/references/file-schedules.md' with { type: 'text' }
import outputsGuide from '../skills/teler/references/outputs.md' with { type: 'text' }
import runsGuide from '../skills/teler/references/runs-and-code-files.md' with { type: 'text' }
import type { Output } from './chats'
import { assertNoFlags, takeFlag, takeOption } from './command-args'
import { emitJson } from './command-output'
import { CommandError, UsageError } from './errors'

/** The Agent Skills file this package ships in `skills/teler/SKILL.md`. */
export const TELER_SKILL: string = skill
/** The guides SKILL.md links to, by their path in the skill folder. */
export const TELER_SKILL_GUIDES: Readonly<Record<string, string>> = {
  'references/agents-and-chats.md': agentsGuide,
  'references/auth-and-access.md': authGuide,
  'references/data-and-queries.md': dataGuide,
  'references/file-schedules.md': schedulesGuide,
  'references/outputs.md': outputsGuide,
  'references/runs-and-code-files.md': runsGuide,
}

const USAGE =
  'Usage: teler agent setup [--claude] [--codex] [--project <dir>] [--print | --dry-run] [--force] [--json]'
const AGENTS = { claude: 'Claude Code', codex: 'Codex' } as const
type Agent = keyof typeof AGENTS
type Action = 'installed' | 'updated' | 'unchanged' | 'kept' | 'replaced'

const DIGEST_LINE = /^ {2}sha256: ([0-9a-f]{64})\n/m
const GUIDE_LINK = /\]\((references\/[a-z0-9-]+\.md)\)/g
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
// A checkout with Windows line endings must render the same files.
const unix = (text: string) => text.replace(/\r\n/g, '\n')

/** The guides a SKILL.md links to, in a stable order. */
function linkedGuides(text: string): string[] {
  return [...new Set([...text.matchAll(GUIDE_LINK)].map((match) => match[1] ?? ''))].sort()
}

/** SKILL.md and its guides as one digest; a skill without guides digests SKILL.md alone. */
function skillDigest(unsigned: string, guides: ReadonlyArray<readonly [string, string]>): string {
  return sha256(unsigned + guides.map(([path, text]) => `\0${path}\0${text}`).join(''))
}

/**
 * The installed SKILL.md: the shipped skill plus metadata naming the CLI that wrote it and a
 * digest of it and its guides, so a later setup can tell its own copy from one the person changed.
 */
export function renderTelerSkill(
  cliVersion: string = version,
  source = TELER_SKILL,
  guides: Readonly<Record<string, string>> = TELER_SKILL_GUIDES
): string {
  const unsigned = unix(source).replace(
    /^(---\n[\s\S]*?\n)---\n/,
    `$1metadata:\n  generator: teler agent setup ${cliVersion}\n---\n`
  )
  const linked = linkedGuides(unsigned).map((path) => [path, unix(guides[path] ?? '')] as const)
  return unsigned.replace('metadata:\n', `metadata:\n  sha256: ${skillDigest(unsigned, linked)}\n`)
}

/** Every installed file, SKILL.md first, by its path in the skill folder. */
export function renderTelerSkillFiles(cliVersion: string = version): Array<[string, string]> {
  const rendered = renderTelerSkill(cliVersion)
  return [
    ['SKILL.md', rendered],
    ...linkedGuides(rendered).map((path): [string, string] => [
      path,
      unix(TELER_SKILL_GUIDES[path] ?? ''),
    ]),
  ]
}

/** An installed skill: its SKILL.md and the guides that file links to (null when missing). */
interface Installed {
  skill: string
  guides: Array<[string, string | null]>
}

async function readInstalled(folder: string): Promise<Installed | null> {
  const text = await readExisting(join(folder, 'SKILL.md'))
  if (text === null) return null
  const guides: Array<[string, string | null]> = []
  for (const path of linkedGuides(text)) guides.push([path, await readExisting(join(folder, path))])
  return { skill: text, guides }
}

function isOwnCopy({ skill: text, guides }: Installed): boolean {
  const match = DIGEST_LINE.exec(text)
  if (match === null) return false
  const present = guides.filter((entry): entry is [string, string] => entry[1] !== null)
  return (
    present.length === guides.length &&
    skillDigest(text.replace(match[0], ''), present) === match[1]
  )
}

function isSame(installed: Installed, files: ReadonlyArray<[string, string]>): boolean {
  const [, rendered] = files[0] ?? []
  const guides = new Map(installed.guides)
  return (
    installed.skill === rendered &&
    files.slice(1).every(([path, text]) => guides.get(path) === text)
  )
}

/** Current skill folders: Claude Code `~/.claude/skills`, Codex `~/.agents/skills`, or a project's. */
function skillFolder(agent: Agent, env: NodeJS.ProcessEnv, project: string | undefined): string {
  const folder = agent === 'claude' ? '.claude' : '.agents'
  if (project) return join(project, folder, 'skills', 'teler')
  const claudeConfig = env.CLAUDE_CONFIG_DIR?.trim()
  if (agent === 'claude' && claudeConfig) return join(resolve(claudeConfig), 'skills', 'teler')
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir()
  return join(home, folder, 'skills', 'teler')
}

async function readExisting(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw new CommandError('SKILL_READ_FAILED', `Could not read ${path}.`)
  }
}

async function writeSkill(path: string, text: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
    await rename(temporary, path)
  } catch {
    await unlink(temporary).catch(() => undefined)
    throw new CommandError('SKILL_WRITE_FAILED', `Could not write ${path}.`)
  }
}

function decide(
  installed: Installed | null,
  files: ReadonlyArray<[string, string]>,
  force: boolean
): Action {
  if (installed === null) return 'installed'
  if (isSame(installed, files)) return 'unchanged'
  if (isOwnCopy(installed)) return 'updated'
  return force ? 'replaced' : 'kept'
}

/** Writes the guides, then SKILL.md; removes guides only its own earlier copy linked. */
async function install(
  folder: string,
  files: ReadonlyArray<[string, string]>,
  installed: Installed | null,
  decision: Action
): Promise<void> {
  for (const [path, text] of [...files.slice(1), ...files.slice(0, 1)])
    await writeSkill(join(folder, path), text)
  if (decision !== 'updated' || installed === null) return
  const current = new Set(files.map(([path]) => path))
  for (const [path] of installed.guides)
    if (!current.has(path)) await unlink(join(folder, path)).catch(() => undefined)
}

const PLAIN: Record<Action, (agent: string) => string> = {
  installed: (agent) => `Installed the Teler skill for ${agent}`,
  updated: (agent) => `Updated the Teler skill for ${agent}`,
  unchanged: (agent) => `The Teler skill for ${agent} is up to date`,
  kept: (agent) => `Kept your changed Teler skill for ${agent}`,
  replaced: (agent) => `Replaced your changed Teler skill for ${agent}`,
}
const PLANNED: Record<Action, string> = {
  installed: 'would install',
  updated: 'would update',
  unchanged: 'unchanged',
  kept: 'would keep',
  replaced: 'would replace',
}

/** `teler agent setup`: teaches Claude Code and Codex to use Teler. Local files only, no network. */
export async function runAgentSetupCommand(
  group: string | undefined,
  action: string | undefined,
  args: string[],
  output: Output,
  env: NodeJS.ProcessEnv
): Promise<boolean> {
  if (group !== 'agent' || action !== 'setup') return false
  const claude = takeFlag(args, '--claude')
  const codex = takeFlag(args, '--codex')
  const projectOption = takeOption(args, '--project')
  const print = takeFlag(args, '--print')
  const dryRun = takeFlag(args, '--dry-run')
  const force = takeFlag(args, '--force')
  assertNoFlags(args)
  if (args.length > 0 || (print && dryRun)) throw new UsageError(USAGE)
  const files = renderTelerSkillFiles()
  if (print) {
    output.write(files.map(([path, text]) => `==> ${path} <==\n${text}`).join('\n'))
    return true
  }
  const project = projectOption === undefined ? undefined : resolve(projectOption)
  if (
    project &&
    !(await stat(project).then(
      (entry) => entry.isDirectory(),
      () => false
    ))
  )
    throw new UsageError('--project must name an existing folder')
  const agents: Agent[] =
    claude || codex
      ? (['claude', 'codex'] as const).filter((agent) => (agent === 'claude' ? claude : codex))
      : ['claude', 'codex']
  const results = []
  for (const agent of agents) {
    const folder = skillFolder(agent, env, project)
    const path = join(folder, 'SKILL.md')
    const installed = await readInstalled(folder)
    const decision = decide(installed, files, force)
    if (!dryRun && ['installed', 'updated', 'replaced'].includes(decision))
      await install(folder, files, installed, decision)
    const reported = dryRun ? PLANNED[decision] : decision
    results.push({
      agent,
      path,
      action: reported,
      files: files.map(([file]) => join(folder, file)),
    })
    if (!output.json)
      output.write(
        dryRun && decision !== 'unchanged'
          ? `Would ${reported.slice('would '.length)} the Teler skill for ${AGENTS[agent]}: ${path}\n`
          : `${PLAIN[decision](AGENTS[agent])}: ${path}\n`
      )
  }
  if (output.json) emitJson(output, { skill: 'teler', results })
  if (!dryRun && results.some((result) => result.action === 'kept'))
    throw new CommandError(
      'SKILL_CHANGED',
      'A Teler skill file you changed was left as it is.',
      'Re-run with --force to replace it with this version.'
    )
  return true
}
