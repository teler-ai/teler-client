import type { LinkEngineInfo } from './protocol'

export interface EngineCommands {
  /** Runs a command and returns its exit code and stdout; never throws for a missing binary. */
  run(command: string[], timeoutMs: number): Promise<{ exitCode: number; stdout: string }>
}

export const systemCommands: EngineCommands = {
  async run(command, timeoutMs) {
    try {
      const child = Bun.spawn(command, {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'ignore',
        timeout: timeoutMs,
      })
      const stdout = await new Response(child.stdout).text()
      return { exitCode: await child.exited, stdout }
    } catch {
      return { exitCode: 127, stdout: '' }
    }
  },
}

/** The Claude Code executable: `TELER_LINK_CLAUDE_BIN`, or `claude` on PATH. */
export function claudeBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env.TELER_LINK_CLAUDE_BIN?.trim() || 'claude'
}

function plainVersion(stdout: string): string | null {
  const match = /\d+\.\d+\.\d+/.exec(stdout)
  return match ? match[0] : null
}

/**
 * The engines this computer can run, signed in or not. Claude Code reports its own sign-in and
 * plan (`claude auth status`); the helper never reads, copies or forwards that credential.
 */
export async function detectEngines(
  commands: EngineCommands = systemCommands,
  env: NodeJS.ProcessEnv = process.env
): Promise<LinkEngineInfo[]> {
  const engines: LinkEngineInfo[] = []
  const binary = claudeBinary(env)
  const versionOutput = await commands.run([binary, '--version'], 10_000)
  const version = versionOutput.exitCode === 0 ? plainVersion(versionOutput.stdout) : null
  if (version) {
    const status = await commands.run([binary, 'auth', 'status'], 15_000)
    let signedIn = false
    let plan: string | undefined
    try {
      const parsed = JSON.parse(status.stdout) as { loggedIn?: unknown; subscriptionType?: unknown }
      signedIn = parsed.loggedIn === true
      if (
        typeof parsed.subscriptionType === 'string' &&
        /^[a-z_]{1,32}$/.test(parsed.subscriptionType)
      )
        plan = parsed.subscriptionType
    } catch {
      signedIn = false
    }
    engines.push({ engine: 'claude_code', version, signedIn, ...(plan ? { plan } : {}) })
  }
  return engines
}
