import { homedir, userInfo } from 'node:os'
import { assertNoFlags } from '../command-args'
import { UsageError } from '../errors'
import { systemCommands } from './engines'
import { installService, serviceStatus, uninstallService, type ServiceHost } from './service'
import { linkServiceCommand, serviceEnvironment } from './service-units'

export const SERVICE_USAGE = 'Usage: teler link service install|uninstall|status [--json]'

export function systemServiceHost(env: NodeJS.ProcessEnv): ServiceHost {
  const name = userInfo().username
  return {
    platform: process.platform,
    home: homedir(),
    env,
    uid: process.getuid?.() ?? 0,
    user: env.USERDOMAIN?.trim() ? `${env.USERDOMAIN.trim()}\\${name}` : name,
    run: (command) => systemCommands.run(command, 30_000),
  }
}

/**
 * `teler link service …`: keep `teler link` running in the background for this user only
 * (systemd user unit, LaunchAgent or a per-user scheduled task). Never needs sudo.
 */
export async function runServiceCommand(
  action: string | undefined,
  args: string[],
  output: { json: boolean; write: (text: string) => void },
  deps: { host: ServiceHost; paired: () => Promise<boolean>; managed: boolean }
): Promise<number> {
  assertNoFlags(args)
  if (args.length > 0) throw new UsageError(SERVICE_USAGE)
  const { host } = deps
  if (action === 'install') {
    if (deps.managed)
      throw new UsageError('Teler Desktop runs Teler Link itself; no service is needed.')
    if (!(await deps.paired()))
      throw new UsageError('Not paired. Run `teler link pair <code>` first.')
    const spec = {
      command: linkServiceCommand(),
      env: serviceEnvironment(host.env, host.platform),
    }
    const path = await installService(host, spec)
    if (output.json) {
      output.write(`${JSON.stringify({ installed: true, platform: host.platform, path })}\n`)
      return 0
    }
    output.write(`Teler Link now runs in the background for this user (${path}).\n`)
    if (host.platform === 'linux')
      output.write(
        'To keep it running while you are logged out, run `loginctl enable-linger $USER` (no sudo needed on most systems).\n'
      )
    output.write('Check it with `teler link service status`.\n')
    return 0
  }
  if (action === 'uninstall') {
    const removed = await uninstallService(host)
    output.write(
      output.json
        ? `${JSON.stringify({ installed: false, removed })}\n`
        : removed
          ? 'Stopped and removed the Teler Link service.\n'
          : 'The Teler Link service was not installed.\n'
    )
    return 0
  }
  if (action === 'status') {
    const status = await serviceStatus(host)
    if (output.json) {
      output.write(`${JSON.stringify(status)}\n`)
      return 0
    }
    output.write(
      !status.installed
        ? 'The Teler Link service is not installed. Install it with `teler link service install`.\n'
        : `The Teler Link service is installed (${status.path}) and ${status.running ? 'running' : 'not running'}.\n`
    )
    return 0
  }
  throw new UsageError(SERVICE_USAGE)
}
