import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { version } from '../package.json'
import { AGENTS, updateOlderSkill } from './agent-setup'

const markerSchema = z.object({ version: z.string(), hint: z.boolean() })

export interface SkillSyncDeps {
  env: NodeJS.ProcessEnv
  /** stderr is a terminal: the hint is for a person. */
  interactive?: boolean
  home?: string
  currentVersion?: string
}

function skillSyncPath(env: NodeJS.ProcessEnv, home = homedir()): string {
  const state = env.XDG_STATE_HOME?.trim() || join(home, '.local', 'state')
  return join(state, 'teler', 'skill-sync.json')
}

/** Not for TELER_NO_SKILL_SYNC, `agent setup` itself, the sync daemon or Teler Desktop's sidecar. */
function shouldSync(argv: readonly string[], env: NodeJS.ProcessEnv): boolean {
  if (env.TELER_NO_SKILL_SYNC?.trim() || env.TELER_SYNC_DAEMON?.trim() === 'managed') return false
  const [group, action] = argv
  return !(group === 'agent' && action === 'setup') && !(group === 'sync' && action === 'daemon')
}

async function readMarker(path: string): Promise<z.infer<typeof markerSchema> | null> {
  try {
    return markerSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return null
  }
}

/**
 * After a CLI update, refreshes the user-folder Teler skills an older `teler agent setup` wrote,
 * once per CLI version, offline and without output. A copy the person changed is kept; a person
 * at a terminal, not using `--json`, hears that once. Never fails the command it runs before.
 */
export async function syncInstalledSkills(
  argv: readonly string[],
  deps: SkillSyncDeps,
  write: (text: string) => void
): Promise<void> {
  try {
    if (!shouldSync(argv, deps.env)) return
    const current = deps.currentVersion ?? version
    const path = skillSyncPath(deps.env, deps.home)
    const marker = await readMarker(path)
    const forPerson =
      (deps.interactive ?? process.stderr.isTTY === true) && !argv.includes('--json')
    // A hint owed from a quiet command is checked again: the copy may be current by now.
    if (marker?.version === current && !(marker.hint && forPerson)) return
    const kept: string[] = []
    for (const agent of ['claude', 'codex'] as const)
      if ((await updateOlderSkill(agent, deps.env, current).catch(() => null)) === 'kept')
        kept.push(AGENTS[agent])
    const hint = kept.length > 0 && forPerson
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, JSON.stringify({ version: current, hint: kept.length > 0 && !hint }), {
      mode: 0o600,
    })
    if (hint)
      write(
        `teler: Kept your changed Teler skill for ${kept.join(' and ')}. Run \`teler agent setup --force\` to replace it with this version.\n`
      )
  } catch {
    // An unreadable skill folder or state file leaves the skill for `teler agent setup`.
  }
}
