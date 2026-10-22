import { command, type CliCommand } from './command-entry'

const DECLARATION =
  '[--output <slot>]... [--input <name>=<ref>]... [--params <json>] [--project <id>]'
const WAIT = '[--wait [--timeout <seconds>]]'

/** Code saved as a File, its runs, and File schedules, for `teler schema`. */
export const CODE_FILE_COMMANDS: readonly CliCommand[] = [
  command(
    'files.save-code',
    'files save-code <local.py> (--to <path> | --file <file-id>) [--input <name>=<ref>]... [--params-schema <schema.json>] [--project <id>] [--org <id>] [--json]',
    "Save a Python script as a code File, or a new version of one, that runs in Teler's sandbox and reads the named inputs: a table by its ref (in --project) or a json, dataset or model File (file:<file-id>)."
  ),
  command(
    'files.run',
    `files run <file-id> --max-credits <amount> --idempotency-key <key> ${DECLARATION} [--org <id>] ${WAIT} [--json]`,
    'Run a code File now, as its schedule would; --wait prints its outputs. Without --output it repeats your last run of this version. Costs credits, at most --max-credits; paid plans only.'
  ),
  command(
    'files.result',
    `files result <run-id> [--org <id>] ${WAIT} [--json]`,
    "Read a code File run's status and, once it succeeded, its outputs; also for a schedule's runs."
  ),
  command(
    'schedule.file.create',
    `schedule file create <file-id> --frequency daily|weekly|monthly (--time-utc <HH:MM> | --time <HH:MM> --timezone <zone>) --idempotency-key <key> [--day-of-week <0-6>] [--day-of-month <1-31>] ${DECLARATION} [--org <id>] [--json]`,
    "Schedule a code File's current version. It starts paused until you approve its monthly spend; without --output it repeats your last run of that version. Paid plans only."
  ),
  command(
    'schedule.file.show',
    'schedule file show <id> [--json]',
    'Show a File schedule: its File version, cadence, revision, state and approved spend.'
  ),
  command(
    'schedule.file.quote',
    'schedule file quote <id> [--max-run-minutes <minutes>] [--json]',
    'Quote what each run may hold and the suggested monthly cap, at the schedule revision to approve.'
  ),
  command(
    'schedule.file.approve',
    'schedule file approve <id> --revision <n> --monthly-credits <amount> --yes [--max-run-minutes <minutes>] [--json]',
    "Approve the server's quote at that revision with a monthly credit cap; a schedule waiting for it starts. Only the schedule's owner; paid plans only."
  ),
  command('schedule.file.pause', 'schedule file pause <id> [--json]', 'Pause a File schedule.'),
  command(
    'schedule.file.resume',
    'schedule file resume <id> [--json]',
    'Resume a paused File schedule; its approved spend must still be in force.'
  ),
  command(
    'schedule.file.re-pin',
    'schedule file re-pin <id> [--json]',
    "Move a File schedule to its File's newest version; approve its spend again before it runs."
  ),
  command(
    'schedule.file.runs',
    'schedule file runs <id> [--json]',
    "Show a File schedule's last ten occurrences, their code runs and why any was skipped."
  ),
  command(
    'schedule.file.delete',
    'schedule file delete <id> --yes [--json]',
    'Delete a File schedule; its approved spend ends with it.'
  ),
]
