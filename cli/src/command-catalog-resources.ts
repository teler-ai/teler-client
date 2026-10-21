import { command, type CliCommand } from './command-entry'

/** Posts, dashboards, schedules and personal knowledge, for `teler schema`. */
export const RESOURCE_COMMANDS: readonly CliCommand[] = [
  ...(['post', 'dashboard'] as const).flatMap((kind) => [
    command(
      `${kind}.list`,
      `${kind} list [--org <id>] [--project <id>] [--limit <count>] [--cursor <cursor>] [--json]`,
      `List ${kind}s you can see.`
    ),
    command(
      `${kind}.get`,
      `${kind} get <${kind}-id> [--include metadata|data|both]${kind === 'dashboard' ? ' [--widget-ids <csv>]' : ''} [--org <id>] [--json]`,
      `Read one ${kind} with its metadata and data.`
    ),
    command(
      `${kind}.update`,
      `${kind} update <id> --file <json-file> [--org <id>] [--json]`,
      `Change a ${kind} from a JSON file.`
    ),
    command(
      `${kind}.delete`,
      `${kind} delete <id> --yes [--org <id>] [--json]`,
      `Delete a ${kind}.`
    ),
    command(
      `${kind}.move`,
      `${kind} move <id> --file <json-file> [--org <id>] [--json]`,
      `Move a ${kind} to another project, named in a JSON file.`
    ),
    command(
      `${kind}.visibility`,
      `${kind} visibility <id> --file <json-file> [--org <id>] [--json]`,
      `Change who can see a ${kind}.`
    ),
  ]),
  command(
    'post.create',
    'post create --file <json-file> [--org <id>] [--json]',
    'Create a post from a JSON file.'
  ),
  command(
    'post.generate',
    'post generate <id> --file <json-file> [--org <id>] [--json]',
    "Draft a post's content with Teler's agent; streams progress."
  ),
  command(
    'post.artifact',
    'post artifact <post-id> <artifact-id> [--download --output <file>] [--org <id>] [--json]',
    'Read, or download, an artifact shown in a post.'
  ),
  command(
    'post.document',
    'post document <post-id> <document-id> [--cursor <cursor>] [--max-bytes <n>] [--page-number <n>] [--anchor <anchor>] [--org <id>] [--json]',
    'Read a document cited by a post, a page at a time.'
  ),
  command(
    'post.comments',
    'post comments <post-id> [--org <id>] [--json]',
    "List a post's comments."
  ),
  command(
    'post.comment',
    'post comment <post-id> --file <json-file> [--org <id>] [--json]',
    'Comment on a post.'
  ),
  command(
    'post.delete-comment',
    'post delete-comment <post-id> <comment-id> [--org <id>] [--json]',
    'Delete one of your comments.'
  ),
  command(
    'post.mark-comments-seen',
    'post mark-comments-seen <post-id> [--org <id>] [--json]',
    "Mark a post's comments as seen."
  ),
  command(
    'post.react',
    'post react <post-id> --file <json-file> [--org <id>] [--json]',
    'React to a post with an emoji.'
  ),
  command(
    'post.unreact',
    'post unreact <post-id> --file <json-file> [--org <id>] [--json]',
    'Remove your emoji reaction from a post.'
  ),
  command('post.hide', 'post hide <post-id> [--org <id>] [--json]', 'Hide a post from your feed.'),
  command(
    'post.unhide',
    'post unhide <post-id> [--org <id>] [--json]',
    'Show a hidden post again.'
  ),
  command(
    'post.export',
    'post export <post-id> --file <html-request.json> --output <file.pdf> [--org <id>]',
    'Export a post as a PDF file.'
  ),
  command(
    'dashboard.create',
    'dashboard create (--name <name> [--refresh-interval <interval>] | --file <json-file>) [--org <id>] [--json]',
    'Create a dashboard by name, or from a JSON file.'
  ),
  command(
    'dashboard.refresh',
    'dashboard refresh <id> [--org <id>] [--json]',
    "Refresh a dashboard's widgets now."
  ),
  command(
    'dashboard.add-widget',
    'dashboard add-widget <id> --artifact <id> --position <json> [--idempotency-key <key>] [--json]',
    'Pin an artifact to a dashboard at a position on its four-column grid.'
  ),
  command(
    'dashboard.approve-refresh',
    'dashboard approve-refresh <id> [--approve <capability,...>] [--json]',
    "Approve what a dashboard's scheduled refreshes may do."
  ),
  command('dashboard.archive', 'dashboard archive <id> --yes [--json]', 'Archive a dashboard.'),
  command(
    'dashboard.shares',
    'dashboard shares <id> [--org <id>] [--json]',
    'List who a dashboard is shared with.'
  ),
  command(
    'dashboard.share',
    'dashboard share <id> --file <json-file> [--org <id>] [--json]',
    'Share a dashboard with people in the organization.'
  ),
  command(
    'dashboard.unshare',
    'dashboard unshare <id> <share-id> [--org <id>] [--json]',
    'Remove one share of a dashboard.'
  ),
  command(
    'dashboard.public-links',
    'dashboard public-links <id> [--org <id>] [--json]',
    "List a dashboard's public links."
  ),
  command(
    'dashboard.create-public-link',
    'dashboard create-public-link <id> --file <json-file> [--org <id>] [--json]',
    'Create a public link to a dashboard.'
  ),
  command(
    'dashboard.revoke-public-link',
    'dashboard revoke-public-link <id> <link-id> --yes [--org <id>] [--json]',
    'Revoke a public link to a dashboard.'
  ),
  command(
    'dashboard.activity',
    'dashboard activity <id> [--org <id>] [--json]',
    "Show a dashboard's recent activity."
  ),
  command(
    'dashboard.create-post',
    'dashboard create-post <id> [--org <id>] [--json]',
    'Create a post from a dashboard.'
  ),
  command(
    'dashboard.templates',
    'dashboard templates [--project <id>] [--org <id>] [--json]',
    'List dashboard templates.'
  ),
  command(
    'dashboard.from-template',
    'dashboard from-template --file <json-file> [--org <id>] [--json]',
    'Start creating a dashboard from a template; its widgets are generated as jobs.'
  ),
  command(
    'dashboard.template-progress',
    'dashboard template-progress --chat <chat-id> [--org <id>] [--json]',
    "Show the progress of a template's widget jobs."
  ),
  command(
    'schedule.create',
    'schedule create --agent <id> --frequency daily|weekly|monthly --time-utc <HH:MM> [--org <id>] [--project <id>] [--approve <capability,...>] [--json]',
    'Schedule a Teler Agent to run daily, weekly or monthly at a UTC time.'
  ),
  command(
    'schedule.approve',
    'schedule approve <id> [--approve <capability,...>] [--json]',
    "Approve what a schedule's runs may do."
  ),
  command('schedule.list', 'schedule list [--org <id>] [--json]', 'List Agent schedules.'),
  command(
    'schedule.update',
    'schedule update <id> [--project <id>] [--frequency <cadence>] [--time-utc <HH:MM>] [--json]',
    'Change only the given fields of a schedule.'
  ),
  command('schedule.pause', 'schedule pause <id> [--json]', 'Pause a schedule.'),
  command('schedule.resume', 'schedule resume <id> [--json]', 'Resume a paused schedule.'),
  command(
    'schedule.history',
    'schedule history <id> [--json]',
    "Show a schedule's last ten occurrences and their runs."
  ),
  command('schedule.delete', 'schedule delete <id> --yes [--json]', 'Delete a schedule.'),
  ...(['skill', 'memory', 'agent'] as const).flatMap((kind) => {
    const noun = { skill: 'skill', memory: 'memory', agent: 'Teler Agent' }[kind]
    return [
      command(
        `${kind}.list`,
        `${kind} list [--org <id>] [--json]`,
        `List your ${kind === 'memory' ? 'memories' : `${noun}s`}.`
      ),
      command(`${kind}.get`, `${kind} get <id> [--json]`, `Read one ${noun}.`),
      command(
        `${kind}.create`,
        `${kind} create --name <slug> --label <label> --content-file <path> [options] [--json]`,
        `Create a ${noun} from a content file.`
      ),
      command(`${kind}.update`, `${kind} update <id> [options] [--json]`, `Change a ${noun}.`),
      command(`${kind}.delete`, `${kind} delete <id> --yes [--json]`, `Delete a ${noun}.`),
    ]
  }),
  command(
    'agent.runs',
    'agent runs [--org <id>] [--agent <id>] [--active] [--limit <count>] [--json]',
    'List your Teler Agent runs; --active shows the running ones.'
  ),
]
