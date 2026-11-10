import { command, type CliCommand } from './command-entry'

/** Teler Link, for `teler schema`. */
export const LINK_COMMANDS: readonly CliCommand[] = [
  command(
    'link.pair',
    'link pair <code> [--name <name>] [--json]',
    'Pair this computer with Teler Link using a code from Agent controls › Teler Link.'
  ),
  command(
    'link',
    'link [start]',
    'Run Teler Link in the foreground: your Teler chats run on your own Claude Code or Codex.'
  ),
  command(
    'link.status',
    'link status [--json]',
    "Show this computer's pairing and every Claude Code and Codex login, signed in or not."
  ),
  command('link.unpair', 'link unpair [--json]', 'Forget the pairing on this computer.'),
  command(
    'link.account.list',
    'link account list [--json]',
    'List the extra Claude Code and Codex logins Teler Link can run chats on.'
  ),
  command(
    'link.account.add',
    'link account add claude_code|codex <config-dir> [--id <id>] [--label <label>] [--json]',
    'Add another login of an engine by its config folder (CLAUDE_CONFIG_DIR or CODEX_HOME); its sign-in is never read.'
  ),
  command('link.account.remove', 'link account remove <id> [--json]', 'Remove an extra login.'),
  command(
    'link.service.install',
    'link service install [--json]',
    'Run Teler Link in the background for this user: a systemd user unit, a LaunchAgent or a per-user scheduled task. No sudo.'
  ),
  command(
    'link.service.uninstall',
    'link service uninstall [--json]',
    'Stop and remove the Teler Link background service.'
  ),
  command(
    'link.service.status',
    'link service status [--json]',
    'Show whether the Teler Link background service is installed and running.'
  ),
]
