import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { UsageError } from '../errors'
import { DEFAULT_ACCOUNT, LINK_ACCOUNT_ID, LINK_ENGINES, type LinkEngine } from './protocol'

/**
 * An extra engine login on this computer: its own config folder, which the engine is pointed at
 * with `CLAUDE_CONFIG_DIR` or `CODEX_HOME`. The helper never reads what is inside it.
 */
export interface LinkAccount {
  engine: LinkEngine
  id: string
  label: string
  configDir: string
}

const accountSchema = z.object({
  engine: z.enum(LINK_ENGINES),
  id: z.string().regex(LINK_ACCOUNT_ID),
  label: z.string().min(1).max(60),
  configDir: z.string().min(1),
})
const fileSchema = z.object({ version: z.literal(1), accounts: z.array(accountSchema) })

/** The variable each engine reads its config folder from. */
export const CONFIG_DIR_VARIABLE = {
  claude_code: 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
} as const

export function accountsFile(env: NodeJS.ProcessEnv): string {
  const config = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(config, 'teler', 'link-accounts.json')
}

export async function readAccounts(env: NodeJS.ProcessEnv): Promise<LinkAccount[]> {
  let raw: string
  try {
    raw = await readFile(accountsFile(env), 'utf8')
  } catch {
    return []
  }
  try {
    return fileSchema.parse(JSON.parse(raw)).accounts
  } catch {
    throw new UsageError(
      `${accountsFile(env)} is not a valid Teler Link accounts file; fix or remove it.`
    )
  }
}

async function writeAccounts(env: NodeJS.ProcessEnv, accounts: LinkAccount[]): Promise<void> {
  const path = accountsFile(env)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify({ version: 1, accounts }, null, 2)}\n`, {
    mode: 0o600,
  })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}

function defaultId(engine: LinkEngine, configDir: string, taken: Set<string>): string {
  const base =
    configDir
      .split(/[\\/]/)
      .filter(Boolean)
      .pop()
      ?.toLowerCase()
      .replace(/^\.+/, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^[-_]+/, '')
      .slice(0, 32) || engine.replace('_', '-')
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base.slice(0, 36)}-${n}`
    if (id !== DEFAULT_ACCOUNT && !taken.has(id)) return id
  }
}

/**
 * Extra logins per engine: with each engine's default login, a computer reports at most 16, the
 * most Teler accepts in one report.
 */
export const MAX_EXTRA_ACCOUNTS = 7

/** Remember another login of an engine; its id is unique on this computer. */
export async function addAccount(
  env: NodeJS.ProcessEnv,
  input: { engine: string; configDir: string; id?: string; label?: string }
): Promise<LinkAccount> {
  if (!LINK_ENGINES.includes(input.engine as LinkEngine))
    throw new UsageError('The engine must be claude_code or codex.')
  const engine = input.engine as LinkEngine
  const configDir = resolve(input.configDir)
  const info = await stat(configDir).catch(() => null)
  if (!info?.isDirectory()) throw new UsageError(`${configDir} is not a folder.`)
  const accounts = await readAccounts(env)
  if (accounts.filter((account) => account.engine === engine).length >= MAX_EXTRA_ACCOUNTS)
    throw new UsageError(
      `Teler Link takes at most ${MAX_EXTRA_ACCOUNTS} other ${engine} logins; remove one first.`
    )
  const taken = new Set(accounts.map((account) => account.id))
  const id = input.id ?? defaultId(engine, configDir, taken)
  if (!LINK_ACCOUNT_ID.test(id) || id === DEFAULT_ACCOUNT)
    throw new UsageError(
      'An account id is 1–40 lowercase letters, digits, - or _, and not "default".'
    )
  if (taken.has(id)) throw new UsageError(`An account with the id ${id} already exists.`)
  if (accounts.some((account) => account.engine === engine && account.configDir === configDir))
    throw new UsageError(`${configDir} is already added.`)
  const label = (input.label ?? id).trim()
  if (label.length < 1 || label.length > 60 || /\p{Cc}/u.test(label))
    throw new UsageError('A label is 1–60 characters.')
  const account = { engine, id, label, configDir }
  await writeAccounts(env, [...accounts, account])
  return account
}

export async function removeAccount(env: NodeJS.ProcessEnv, id: string): Promise<boolean> {
  const accounts = await readAccounts(env)
  const remaining = accounts.filter((account) => account.id !== id)
  if (remaining.length === accounts.length) return false
  await writeAccounts(env, remaining)
  return true
}

/**
 * The environment an engine runs in for one of its logins, or null when this computer does not
 * know that login. The default login keeps the engine's own default config folder.
 */
export function accountEnvironment(
  engine: LinkEngine,
  account: string,
  accounts: readonly LinkAccount[],
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv | null {
  if (account === DEFAULT_ACCOUNT) return env
  const match = accounts.find((entry) => entry.engine === engine && entry.id === account)
  return match ? { ...env, [CONFIG_DIR_VARIABLE[engine]]: match.configDir } : null
}
