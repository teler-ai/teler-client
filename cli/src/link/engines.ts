import { accountEnvironment, type LinkAccount } from './accounts'
import { DEFAULT_ACCOUNT, type LinkEngine, type LinkEngineInfo } from './protocol'

export interface CommandOutcome {
  exitCode: number
  stdout: string
  stderr: string
}

export interface EngineCommands {
  /** Runs a command and returns its exit code and output; never throws for a missing binary. */
  run(command: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<CommandOutcome>
}

export const systemCommands: EngineCommands = {
  async run(command, timeoutMs, env) {
    try {
      const child = Bun.spawn(command, {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: timeoutMs,
        ...(env ? { env } : {}),
      })
      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      return { exitCode: await child.exited, stdout, stderr }
    } catch {
      return { exitCode: 127, stdout: '', stderr: '' }
    }
  },
}

/** The Claude Code executable: `TELER_LINK_CLAUDE_BIN`, or `claude` on PATH. */
export function claudeBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env.TELER_LINK_CLAUDE_BIN?.trim() || 'claude'
}

/** The Codex executable: `TELER_LINK_CODEX_BIN`, or `codex` on PATH. */
export function codexBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env.TELER_LINK_CODEX_BIN?.trim() || 'codex'
}

function plainVersion(stdout: string): string | null {
  const match = /\d+\.\d+\.\d+/.exec(stdout)
  return match ? match[0] : null
}

type SignIn = Pick<LinkEngineInfo, 'signedIn' | 'plan' | 'identity'>

/** `claude auth status` prints JSON: loggedIn, subscriptionType and the account's email. */
export function parseClaudeStatus(outcome: CommandOutcome): SignIn {
  try {
    const parsed = JSON.parse(outcome.stdout) as {
      loggedIn?: unknown
      subscriptionType?: unknown
      email?: unknown
    }
    const signedIn = parsed.loggedIn === true
    const plan =
      typeof parsed.subscriptionType === 'string' && /^[a-z_]{1,32}$/.test(parsed.subscriptionType)
        ? parsed.subscriptionType
        : undefined
    const identity =
      typeof parsed.email === 'string' &&
      parsed.email.length <= 120 &&
      !/\p{Cc}/u.test(parsed.email)
        ? parsed.email
        : undefined
    return {
      signedIn,
      ...(signedIn && plan ? { plan } : {}),
      ...(signedIn && identity ? { identity } : {}),
    }
  } catch {
    return { signedIn: false }
  }
}

/** `codex login status` says "Logged in using ChatGPT" or "… an API key" and fails when signed out. */
export function parseCodexStatus(outcome: CommandOutcome): SignIn {
  const text = `${outcome.stdout}\n${outcome.stderr}`
  if (outcome.exitCode !== 0 || /not logged in/i.test(text) || !/logged in/i.test(text))
    return { signedIn: false }
  if (/chatgpt/i.test(text)) return { signedIn: true, plan: 'chatgpt' }
  if (/api key/i.test(text)) return { signedIn: true, plan: 'api_key' }
  return { signedIn: true }
}

const ENGINES: Record<
  LinkEngine,
  {
    binary(env: NodeJS.ProcessEnv): string
    status: string[]
    parse(outcome: CommandOutcome): SignIn
  }
> = {
  claude_code: { binary: claudeBinary, status: ['auth', 'status'], parse: parseClaudeStatus },
  codex: { binary: codexBinary, status: ['login', 'status'], parse: parseCodexStatus },
}

/**
 * Every engine login this computer can run, signed in or not: each engine's default login and
 * the extra ones added with `teler link account add`. Each engine reports its own sign-in and
 * plan; the helper never reads, copies or forwards that credential.
 */
export async function detectEngines(
  commands: EngineCommands = systemCommands,
  env: NodeJS.ProcessEnv = process.env,
  accounts: readonly LinkAccount[] = []
): Promise<LinkEngineInfo[]> {
  const found: LinkEngineInfo[] = []
  for (const engine of ['claude_code', 'codex'] as const) {
    const spec = ENGINES[engine]
    const binary = spec.binary(env)
    const versionOutput = await commands.run([binary, '--version'], 10_000, env)
    const version = versionOutput.exitCode === 0 ? plainVersion(versionOutput.stdout) : null
    if (!version) continue
    const logins = [
      { account: DEFAULT_ACCOUNT, label: 'Default' },
      ...accounts
        .filter((account) => account.engine === engine)
        .map((account) => ({ account: account.id, label: account.label })),
    ]
    for (const login of logins) {
      const loginEnv = accountEnvironment(engine, login.account, accounts, env) ?? env
      const status = await commands.run([binary, ...spec.status], 15_000, loginEnv)
      found.push({ engine, ...login, version, ...spec.parse(status) })
    }
  }
  return found
}
