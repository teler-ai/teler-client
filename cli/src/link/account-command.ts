import { assertNoFlags, takeOption } from '../command-args'
import { UsageError } from '../errors'
import { addAccount, CONFIG_DIR_VARIABLE, readAccounts, removeAccount } from './accounts'
import { detectEngines, type EngineCommands } from './engines'

export const ACCOUNT_USAGE =
  'Usage: teler link account list | teler link account add claude_code|codex <config-dir> [--id <id>] [--label <label>] | teler link account remove <id>'

const SIGN_IN = {
  claude_code: (dir: string) => `CLAUDE_CONFIG_DIR=${dir} claude auth login`,
  codex: (dir: string) => `CODEX_HOME=${dir} codex login`,
} as const

/** `teler link account …`: the extra engine logins Teler Link can run chats on. */
export async function runAccountCommand(
  action: string | undefined,
  args: string[],
  output: { json: boolean; write: (text: string) => void },
  deps: { env: NodeJS.ProcessEnv; commands?: EngineCommands }
): Promise<number> {
  const { env } = deps
  if (action === 'list') {
    assertNoFlags(args)
    if (args.length > 0) throw new UsageError(ACCOUNT_USAGE)
    const accounts = await readAccounts(env)
    if (output.json) {
      output.write(`${JSON.stringify({ accounts })}\n`)
      return 0
    }
    output.write("Each engine's own login is always available as `default`.\n")
    for (const account of accounts)
      output.write(`${account.id}  ${account.engine}  ${account.label}  ${account.configDir}\n`)
    if (accounts.length === 0)
      output.write('No other accounts. Add one with `teler link account add`.\n')
    return 0
  }
  if (action === 'add') {
    const id = takeOption(args, '--id')
    const label = takeOption(args, '--label')
    assertNoFlags(args)
    const [engine, configDir] = args
    if (!engine || !configDir || args.length !== 2) throw new UsageError(ACCOUNT_USAGE)
    const account = await addAccount(env, {
      engine,
      configDir,
      ...(id ? { id } : {}),
      ...(label ? { label } : {}),
    })
    const engines = await detectEngines(deps.commands, env, [account])
    const signedIn = engines.some(
      (entry) => entry.engine === account.engine && entry.account === account.id && entry.signedIn
    )
    if (output.json) {
      output.write(`${JSON.stringify({ account, signedIn })}\n`)
      return 0
    }
    output.write(
      `Added ${account.id} (${account.engine}, ${CONFIG_DIR_VARIABLE[account.engine]}=${account.configDir}).\n`
    )
    output.write(
      signedIn
        ? 'It is signed in. Choose it in Teler: Agent controls › Teler Link.\n'
        : `It is not signed in yet: run \`${SIGN_IN[account.engine](account.configDir)}\`.\n`
    )
    return 0
  }
  if (action === 'remove') {
    assertNoFlags(args)
    const [id] = args
    if (!id || args.length !== 1) throw new UsageError(ACCOUNT_USAGE)
    const removed = await removeAccount(env, id)
    if (!removed) throw new UsageError(`No account with the id ${id}.`)
    output.write(output.json ? `${JSON.stringify({ removed: id })}\n` : `Removed ${id}.\n`)
    return 0
  }
  throw new UsageError(ACCOUNT_USAGE)
}
