import { fileURLToPath } from 'node:url'
import { isCompiledModule } from '../runtime'
import { resolveTelerUrl } from '../url'

export const SYSTEMD_UNIT = 'teler-link.service'
export const LAUNCH_AGENT_LABEL = 'ai.teler.link'
export const WINDOWS_TASK = 'Teler Link'

/** What the background service runs: this CLI with `link`, in a fixed environment. */
export interface ServiceSpec {
  command: string[]
  env: Record<string, string>
}

/** The same CLI as this one: the compiled executable, or `bun <entry>` from a checkout. */
export function linkServiceCommand(
  execPath = process.execPath,
  moduleUrl = import.meta.url
): string[] {
  if (isCompiledModule(moduleUrl)) return [execPath, 'link']
  return [execPath, fileURLToPath(new URL('../index.ts', moduleUrl)), 'link']
}

/** Variables the service keeps from the shell that installed it, when they are set. */
const KEPT_VARIABLES = [
  'TELER_LINK_CLAUDE_BIN',
  'TELER_LINK_CODEX_BIN',
  'TELER_CREDENTIAL_STORE',
  'XDG_CONFIG_HOME',
  'XDG_STATE_HOME',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
] as const

/**
 * The service's environment: the Teler origin it was installed for and, outside Windows (where a
 * task has the member's own environment), the PATH that finds Claude Code and Codex. Never a
 * token or other credential.
 */
export function serviceEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Record<string, string> {
  const kept: Record<string, string> = { TELER_URL: resolveTelerUrl(env).origin }
  if (platform !== 'win32' && env.PATH) kept.PATH = env.PATH
  for (const name of KEPT_VARIABLES) {
    const value = env[name]?.trim()
    if (value) kept[name] = value
  }
  return kept
}

/** A systemd value in double quotes: backslash, quote, `%` and `$` escaped. */
function systemdQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`
}

/** Exit status 2 is a usage error (not paired, pairing revoked): restarting cannot fix it. */
export function systemdUnit(spec: ServiceSpec): string {
  return [
    '[Unit]',
    'Description=Teler Link: runs your Teler chats on this computer',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${spec.command.map(systemdQuote).join(' ')}`,
    ...Object.entries(spec.env).map(
      ([name, value]) => `Environment=${systemdQuote(`${name}=${value}`)}`
    ),
    'Restart=on-failure',
    'RestartSec=10',
    'RestartPreventExitStatus=2',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function launchAgentPlist(spec: ServiceSpec & { logPath: string }): string {
  const strings = (values: readonly string[]) =>
    values.map((value) => `    <string>${xml(value)}</string>`)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${LAUNCH_AGENT_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...strings(spec.command),
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    ...Object.entries(spec.env).flatMap(([name, value]) => [
      `    <key>${xml(name)}</key>`,
      `    <string>${xml(value)}</string>`,
    ]),
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>ThrottleInterval</key>',
    '  <integer>30</integer>',
    '  <key>ProcessType</key>',
    '  <string>Background</string>',
    '  <key>StandardOutPath</key>',
    `  <string>${xml(spec.logPath)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xml(spec.logPath)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n')
}

/** The batch file the Windows task runs: it sets the service's environment, then the CLI. */
export function windowsLauncher(spec: ServiceSpec): string {
  const batch = (value: string) => value.replace(/%/g, '%%')
  return [
    '@echo off',
    ...Object.entries(spec.env).map(([name, value]) => `set "${name}=${batch(value)}"`),
    spec.command.map((part) => `"${batch(part)}"`).join(' '),
    '',
  ].join('\r\n')
}

/**
 * A per-user task that starts at the member's own logon (no administrator rights), restarts after
 * a failure and never times out.
 */
export function windowsTaskXml(input: { userId: string; launcherPath: string }): string {
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo><Description>Teler Link: runs your Teler chats on this computer</Description></RegistrationInfo>',
    `  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(input.userId)}</UserId></LogonTrigger></Triggers>`,
    `  <Principals><Principal id="Author"><UserId>${xml(input.userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>`,
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>',
    '    <Hidden>true</Hidden>',
    '  </Settings>',
    `  <Actions Context="Author"><Exec><Command>cmd.exe</Command><Arguments>/d /c "${xml(input.launcherPath)}"</Arguments></Exec></Actions>`,
    '</Task>',
    '',
  ].join('\r\n')
}
