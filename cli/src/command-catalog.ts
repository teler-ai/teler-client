import { artifactGetInputJsonSchema } from './artifact-command'
import {
  describeDataTableInputJsonSchema,
  listDataTablesInputJsonSchema,
  listProjectsInputJsonSchema,
} from './data-contract'
import { RESOURCE_COMMANDS } from './command-catalog-resources'
import { CODE_FILE_COMMANDS } from './command-catalog-code'
import { command, type CliCommand } from './command-entry'
import { runSelectionInputJsonSchema, runSubmitInputJsonSchemas } from './run-contract'

const RUN_FLAGS = {
  organizationId: '--org',
  projectId: '--project',
  chatId: '--chat',
  maximumCredits: '--max-credits',
  idempotencyKey: '--idempotency-key',
  timeoutSeconds: '--execution-timeout',
  capabilities: '--capabilities',
}
const SUBMIT =
  '--project <id> --max-credits <amount> --idempotency-key <key> [--chat <id>] [--org <id>] [--execution-timeout <seconds>] [--capabilities <capability,...>] [--wait [--timeout <seconds>]] [--json]'
const RUN_SELECTION = {
  inputSchema: runSelectionInputJsonSchema,
  flags: { id: '<run-id>', organizationId: '--org' },
}
const DATA_PAGE = {
  organizationId: '--org',
  projectId: '--project',
  limit: '--limit',
  offset: '--offset',
}

/** Every `teler` command, for `teler schema`. Typed inputs come from the same schemas the commands parse. */
export const CLI_COMMANDS: readonly CliCommand[] = [
  command('version', '--version [--json]', 'Print the CLI version.'),
  command(
    'update',
    'update [--check] [--json]',
    'Check for, or download, verify and install, the newest stable CLI release.'
  ),
  command(
    'schema',
    'schema [command] [--json]',
    "List every command, or show one command's usage, flags and input schema. Works offline."
  ),
  command(
    'auth.login',
    'auth login [--device-file <absolute-path>]',
    'Sign in by approving a code in a browser; keeps the sign-in in the system keyring, or in a private file with TELER_CREDENTIAL_STORE=file.'
  ),
  command(
    'auth.status',
    'auth status [--json]',
    'Show the signed-in account on the selected Teler origin.'
  ),
  command(
    'auth.logout',
    'auth logout',
    'Revoke the stored sign-in and remove it from this computer.'
  ),
  command(
    'agent.setup',
    'agent setup [--claude] [--codex] [--project <dir>] [--print | --dry-run] [--force] [--json]',
    'Install the Teler skill for Claude Code and Codex in your user folders or a project. Offline; keeps a skill file you changed unless --force. Later CLI versions refresh the user-folder copy it wrote.'
  ),
  command(
    'project.list',
    'project list [--org <id>] [--json]',
    'List the projects visible to you in the organization.',
    { inputSchema: listProjectsInputJsonSchema, flags: { organizationId: '--org' } }
  ),
  command(
    'data.list',
    'data list --project <id> [--query <text>] [--limit <n>] [--offset <n>] [--org <id>] [--json]',
    "List a project's tables with queryability and source metadata; page with --offset.",
    { inputSchema: listDataTablesInputJsonSchema, flags: { ...DATA_PAGE, query: '--query' } }
  ),
  command(
    'data.describe',
    'data describe <ref> --project <id> [--limit <n>] [--offset <n>] [--org <id>] [--json]',
    'List the columns of one queryable table.',
    { inputSchema: describeDataTableInputJsonSchema, flags: { ...DATA_PAGE, ref: '<ref>' } }
  ),
  command(
    'data.query',
    `data query --file <query.sql> [--row-limit <n>] ${SUBMIT}`,
    "Run one SQL SELECT on the project's data in a sandbox and return up to --row-limit rows. Costs credits, at most --max-credits.",
    {
      inputSchema: runSubmitInputJsonSchemas.sql,
      flags: { ...RUN_FLAGS, 'task.sql': '--file', 'task.rowLimit': '--row-limit' },
    }
  ),
  command(
    'run.python',
    `run python --file <code.py> ${SUBMIT}`,
    "Run a Python file in a fresh sandbox that reads the project's data; returns its output and charts. Costs credits, at most --max-credits.",
    {
      inputSchema: runSubmitInputJsonSchemas.python,
      flags: { ...RUN_FLAGS, 'task.code': '--file' },
    }
  ),
  command(
    'artifact.create',
    `artifact create --file <chart.json> ${SUBMIT}`,
    'Import a static bar, line, table or metric chart from a JSON file; it becomes a chart or table in a chat. Costs credits, at most --max-credits.',
    {
      inputSchema: runSubmitInputJsonSchemas.artifact,
      flags: { ...RUN_FLAGS, 'task.artifact': '--file' },
    }
  ),
  command(
    'run.get',
    'run get <run-id> [--org <id>] [--json]',
    "Read a run's receipt: status, output, charged credits, the charts, tables and files it made (artifacts) and, when it failed, errorCode and errorDetail.",
    RUN_SELECTION
  ),
  command(
    'run.wait',
    'run wait <run-id> [--org <id>] [--timeout <seconds>] [--json]',
    'Wait for a run to finish and print its final receipt; exits 1 if it failed or was cancelled. Never resubmits.',
    RUN_SELECTION
  ),
  command(
    'run.cancel',
    'run cancel <run-id> [--org <id>] [--json]',
    'Ask Teler to cancel a run and print its receipt.',
    RUN_SELECTION
  ),
  command(
    'artifact.get',
    'artifact get <artifact-id> --chat <chat-id-or-url> [--slug <slug>] [--download --output <file>] [--json]',
    'Show the metadata of one chart, table, model or data file a chat made, or download its bytes to a new local file.',
    {
      inputSchema: artifactGetInputJsonSchema,
      flags: {
        id: '<artifact-id>',
        chatId: '--chat',
        slug: '--slug',
        download: '--download',
        output: '--output',
      },
    }
  ),
  command(
    'artifact.source',
    'artifact source <artifact-id> [--org <id>] [--json]',
    'Show the source recorded for a chart, table or model and when it was produced.'
  ),
  command(
    'chat.list',
    'chat list [--limit <count>] [--json]',
    'List your most recent chats (20 by default, at most 100).'
  ),
  command('chat.show', 'chat show <chat-id-or-url> [--json]', 'Show one chat and its messages.'),
  command(
    'chat.artifacts',
    'chat artifacts <chat-id-or-url> [--json]',
    'List what a chat made (charts, tables, models and data files) with their IDs and slugs.'
  ),
  command(
    'chat.seen',
    'chat seen <chat-id-or-url> [--json]',
    "Mark a chat's finished turn as seen."
  ),
  command(
    'chat.delete',
    'chat delete <chat-id-or-url> --yes [--json]',
    'Permanently delete one of your own chats and its messages.'
  ),
  command(
    'send',
    'send (--chat <chat-id-or-url> | --new) [--org <id>] [--model-set lite|pro] [--title <title>] [--wait] [--timeout <seconds>] [--json] [--metadata-only] "message"',
    "Ask Teler's analyst agent in a new or existing chat; with --wait, stream the turn and its final answer as NDJSON."
  ),
  command(
    'steer',
    'steer <chat-id-or-url> [--timeout <seconds>] [--json] "message"',
    "Add guidance to a chat's running turn."
  ),
  command(
    'approval.respond',
    'approval respond <chat-id-or-url> <approval-id> (--allow | --deny) [--org <id>] [--wait] [--timeout <seconds>] [--json]',
    'Allow or deny one pending approval in a chat; with --wait, follow the resumed turn.'
  ),
  command(
    'task.watch',
    'task watch <chat-id-or-url> <task-id> [--timeout <seconds>] [--json] [--metadata-only]',
    'Follow a chat turn until it ends and print its final answer.'
  ),
  command(
    'status',
    'status [--org <id>] [--json]',
    'Show running chats and Agent runs, finished chats you have not seen, and unread notifications.'
  ),
  command(
    'watch',
    'watch [--org <id>] [--interval <seconds>] [--timeout <seconds>] [--json]',
    'Report each chat turn, Agent run or notification as it starts or ends.'
  ),
  command(
    'notifications',
    'notifications [--org <id>] [--all] [--limit <count>] [--json]',
    "List an organization's unread notifications, or all of them with --all."
  ),
  command(
    'agent-access.show',
    'agent-access show [--org <id>] [--json]',
    'Show your Agent Access policy: its defaults and rules.'
  ),
  command(
    'agent-access.set',
    'agent-access set --preset standard|ask|read-only|allow-everything [--yes] [--org <id>] [--json]',
    'Set your Agent Access policy to a preset, as the app does; allow-everything needs --yes.'
  ),
  command(
    'files.list',
    'files list [--path <path>] [--query <text>] [--kind <kind>] [--scope <scope>] [--limit <count>] [--offset <count>] [--org <id>] [--json]',
    'List files and folders in Teler Files.'
  ),
  command(
    'files.read',
    'files read <path>... [--org <id>] [--json]',
    'Read the content of one or more files.'
  ),
  command(
    'files.search',
    'files search <query> [--path <path>] [--scope <scope>] [--limit <count>] [--org <id>] [--json]',
    'Search the text of files.'
  ),
  command(
    'files.write',
    'files write <path> <content> [--org <id>] [--json]',
    'Create or replace a text file.'
  ),
  command('files.mkdir', 'files mkdir <path> [--org <id>] [--json]', 'Create a folder.'),
  command(
    'files.move',
    'files move <from> <to> [--org <id>] [--json]',
    'Move or rename a file or folder.'
  ),
  command('files.copy', 'files copy <from> <to> [--org <id>] [--json]', 'Copy a file or folder.'),
  command(
    'files.delete',
    'files delete <path|file-id> --yes [--org <id>] [--json]',
    'Move a File to the trash, from where it can be restored for a while; folders are deleted in the Teler app.'
  ),
  command('files.restore', 'files restore <file-id> [--json]', 'Restore a File from the trash.'),
  command(
    'files.trash',
    'files trash [--limit <count>] [--offset <count>] [--org <id>] [--json]',
    'List the Files in the trash and until when each can be restored.'
  ),
  command(
    'upload',
    'upload <local-file> [--org <id>] [--to <path>] [--scope personal|organization] [--project <id>] [--wait] [--timeout <seconds>] [--json]',
    'Upload a local file for Teler to process into tables or documents; --wait waits for processing.'
  ),
  command(
    'upload.list',
    'upload list [--org <id>] [--status <status>] [--limit <count>] [--json]',
    'List uploads and their processing status.'
  ),
  command(
    'upload.status',
    'upload status <job-id> [--wait] [--timeout <seconds>] [--json]',
    "Show one upload's processing status; --wait waits until it settles."
  ),
  command(
    'sync',
    'sync <folder> --to <remote-path> [--org <id>] [--project <id>] [--once] [--dry-run] [--json]',
    'Keep uploading a local folder to a Teler Files path, in the background or once.'
  ),
  command('sync.list', 'sync list [--json]', 'List the folders registered for sync.'),
  command('sync.status', 'sync status [--json]', 'Show sync state, per folder and per file.'),
  command('sync.pause', 'sync pause <id> [--json]', 'Pause uploads for a registered folder.'),
  command(
    'sync.resume',
    'sync resume <id> [--json]',
    'Resume uploads for a registered folder and start the sync daemon.'
  ),
  command(
    'sync.retry',
    'sync retry <id> [--json]',
    "Retry a folder's waiting files on the next pass."
  ),
  command(
    'sync.remove',
    'sync remove <id> [--json]',
    'Stop syncing a folder; uploaded files stay in Teler.'
  ),
  command('sync.stop', 'sync stop [--json]', 'Stop the sync daemon; registrations stay.'),
  command(
    'sync.daemon',
    'sync daemon',
    'Run the sync daemon in the foreground, for a service manager.'
  ),
  ...RESOURCE_COMMANDS,
  ...CODE_FILE_COMMANDS,
]
