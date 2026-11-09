import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CommandError } from '../errors'
import type { CommandOutcome } from './engines'
import {
  LAUNCH_AGENT_LABEL,
  launchAgentPlist,
  SYSTEMD_UNIT,
  systemdUnit,
  WINDOWS_TASK,
  windowsLauncher,
  windowsTaskXml,
  type ServiceSpec,
} from './service-units'

/** The computer the service is installed on; tests pass a fake one. */
export interface ServiceHost {
  platform: NodeJS.Platform
  home: string
  env: NodeJS.ProcessEnv
  /** The user's numeric id (macOS `gui/<uid>`). */
  uid: number
  /** `DOMAIN\user` for the Windows task's logon trigger. */
  user: string
  run(command: string[]): Promise<CommandOutcome>
}

export interface ServiceStatus {
  platform: NodeJS.Platform
  installed: boolean
  running: boolean
  path: string
}

function systemdPath(host: ServiceHost): string {
  const config = host.env.XDG_CONFIG_HOME?.trim() || join(host.home, '.config')
  return join(config, 'systemd', 'user', SYSTEMD_UNIT)
}

function windowsFolder(host: ServiceHost): string {
  const state = host.env.XDG_STATE_HOME?.trim() || join(host.home, '.local', 'state')
  return join(state, 'teler', 'link')
}

/** Where the service's definition lives on this platform. */
export function servicePath(host: ServiceHost): string {
  if (host.platform === 'darwin')
    return join(host.home, 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`)
  if (host.platform === 'win32') return join(windowsFolder(host), 'teler-link-task.xml')
  return systemdPath(host)
}

async function exists(path: string): Promise<boolean> {
  return Boolean(await stat(path).catch(() => null))
}

async function writeDefinition(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, content, { mode: 0o600 })
}

async function must(host: ServiceHost, command: string[], what: string): Promise<void> {
  const outcome = await host.run(command)
  if (outcome.exitCode !== 0) {
    throw new CommandError(
      'LINK_SERVICE_FAILED',
      `Could not ${what}: \`${command.slice(0, 3).join(' ')}\` exited with ${outcome.exitCode}.`,
      'Run `teler link` in a terminal instead, and keep it open.'
    )
  }
}

function unsupported(host: ServiceHost): never {
  throw new CommandError(
    'LINK_SERVICE_UNSUPPORTED',
    `Teler Link has no background service for ${host.platform}.`,
    'Run `teler link` in a terminal instead, and keep it open.'
  )
}

/** Installs and starts the service for this user only; never needs administrator rights. */
export async function installService(host: ServiceHost, spec: ServiceSpec): Promise<string> {
  const path = servicePath(host)
  if (host.platform === 'linux') {
    await writeDefinition(path, systemdUnit(spec))
    await must(host, ['systemctl', '--user', 'daemon-reload'], 'reload systemd')
    await must(host, ['systemctl', '--user', 'enable', SYSTEMD_UNIT], 'enable the service')
    await must(host, ['systemctl', '--user', 'restart', SYSTEMD_UNIT], 'start the service')
    return path
  }
  if (host.platform === 'darwin') {
    const logPath = join(host.home, 'Library', 'Logs', 'teler-link.log')
    await mkdir(dirname(logPath), { recursive: true })
    await writeDefinition(path, launchAgentPlist({ ...spec, logPath }))
    await host.run(['launchctl', 'bootout', `gui/${host.uid}/${LAUNCH_AGENT_LABEL}`])
    await must(host, ['launchctl', 'bootstrap', `gui/${host.uid}`, path], 'load the LaunchAgent')
    return path
  }
  if (host.platform === 'win32') {
    const launcherPath = join(windowsFolder(host), 'teler-link.cmd')
    await writeDefinition(launcherPath, windowsLauncher(spec))
    // Task Scheduler reads its XML as UTF-16 with a byte-order mark.
    const xml = windowsTaskXml({ userId: host.user, launcherPath })
    await writeDefinition(
      path,
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')])
    )
    await must(
      host,
      ['schtasks', '/Create', '/TN', WINDOWS_TASK, '/XML', path, '/F'],
      'create the task'
    )
    await must(host, ['schtasks', '/Run', '/TN', WINDOWS_TASK], 'start the task')
    return path
  }
  return unsupported(host)
}

export async function uninstallService(host: ServiceHost): Promise<boolean> {
  const path = servicePath(host)
  const installed = await exists(path)
  if (host.platform === 'linux') {
    await host.run(['systemctl', '--user', 'disable', '--now', SYSTEMD_UNIT])
    await rm(path, { force: true })
    await host.run(['systemctl', '--user', 'daemon-reload'])
  } else if (host.platform === 'darwin') {
    await host.run(['launchctl', 'bootout', `gui/${host.uid}/${LAUNCH_AGENT_LABEL}`])
    await rm(path, { force: true })
  } else if (host.platform === 'win32') {
    await host.run(['schtasks', '/End', '/TN', WINDOWS_TASK])
    await host.run(['schtasks', '/Delete', '/TN', WINDOWS_TASK, '/F'])
    await rm(path, { force: true })
    await rm(join(windowsFolder(host), 'teler-link.cmd'), { force: true })
  } else unsupported(host)
  return installed
}

export async function serviceStatus(host: ServiceHost): Promise<ServiceStatus> {
  const path = servicePath(host)
  const installed = await exists(path)
  let running = false
  if (host.platform === 'linux') {
    const outcome = await host.run(['systemctl', '--user', 'is-active', SYSTEMD_UNIT])
    running = outcome.stdout.trim() === 'active'
  } else if (host.platform === 'darwin') {
    const outcome = await host.run(['launchctl', 'print', `gui/${host.uid}/${LAUNCH_AGENT_LABEL}`])
    running = outcome.exitCode === 0 && /\bstate = running\b/.test(outcome.stdout)
  } else if (host.platform === 'win32') {
    const outcome = await host.run(['schtasks', '/Query', '/TN', WINDOWS_TASK, '/FO', 'LIST'])
    running = outcome.exitCode === 0 && /:\s*Running\b/i.test(outcome.stdout)
  }
  return { platform: host.platform, installed, running, path }
}
