import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { version } from '../package.json'
import skill from '../skills/teler/SKILL.md' with { type: 'text' }
import type { Output } from './chats'
import { assertNoFlags, takeFlag, takeOption } from './command-args'
import { emitJson } from './command-output'
import { CommandError, UsageError } from './errors'

/** The Agent Skills file this package ships in `skills/teler/SKILL.md`. */
export const TELER_SKILL: string = skill

const USAGE =
  'Usage: teler agent setup [--claude] [--codex] [--project <dir>] [--print | --dry-run] [--force] [--json]'
const AGENTS = { claude: 'Claude Code', codex: 'Codex' } as const
type Agent = keyof typeof AGENTS
type Action = 'installed' | 'updated' | 'unchanged' | 'kept' | 'replaced'

const DIGEST_LINE = /^ {2}sha256: ([0-9a-f]{64})\n/m
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * The installed file: the shipped skill plus metadata naming the CLI that wrote it and a digest
 * of everything else, so a later setup can tell its own copy from one the person changed.
 */
export function renderTelerSkill(cliVersion: string = version): string {
  const unsigned = TELER_SKILL.replace(
    /^(---\n[\s\S]*?\n)---\n/,
    `$1metadata:\n  generator: teler agent setup ${cliVersion}\n---\n`
  )
  return unsigned.replace('metadata:\n', `metadata:\n  sha256: ${sha256(unsigned)}\n`)
}

function isOwnCopy(text: string): boolean {
  const match = DIGEST_LINE.exec(text)
  return match !== null && sha256(text.replace(match[0], '')) === match[1]
}

/** Current skill folders: Claude Code `~/.claude/skills`, Codex `~/.agents/skills`, or a project's. */
function skillPath(agent: Agent, env: NodeJS.ProcessEnv, project: string | undefined): string {
  const folder = agent === 'claude' ? '.claude' : '.agents'
  if (project) return join(project, folder, 'skills', 'teler', 'SKILL.md')
  const claudeConfig = env.CLAUDE_CONFIG_DIR?.trim()
  if (agent === 'claude' && claudeConfig)
    return join(resolve(claudeConfig), 'skills', 'teler', 'SKILL.md')
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir()
  return join(home, folder, 'skills', 'teler', 'SKILL.md')
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

function decide(existing: string | null, rendered: string, force: boolean): Action {
  if (existing === null) return 'installed'
  if (existing === rendered) return 'unchanged'
  if (isOwnCopy(existing)) return 'updated'
  return force ? 'replaced' : 'kept'
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
  const rendered = renderTelerSkill()
  if (print) {
    output.write(rendered)
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
    const path = skillPath(agent, env, project)
    const decision = decide(await readExisting(path), rendered, force)
    if (!dryRun && ['installed', 'updated', 'replaced'].includes(decision))
      await writeSkill(path, rendered)
    const reported = dryRun ? PLANNED[decision] : decision
    results.push({ agent, path, action: reported })
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
