import { version } from '../package.json'
import { RESOURCE_USAGE } from './resource-options'

export const USAGE = `teler — authenticated command-line client for teler.ai

TELER_URL selects the Teler origin and defaults to https://app.teler.ai.
TELER_TOKEN may provide a token without storing it in the OS credential store.
TELER_CREDENTIAL_STORE=file enables a private file store for headless hosts.
TELER_ACCESS_TOKEN passes Cloudflare Access on TELER_URL (sent only there).
Release builds check for updates once a day; TELER_NO_UPDATE_CHECK=1 turns that off.

Usage:
  teler --version
  teler update [--check] [--json]
  teler schema [command] [--json]
  teler project list [--org <id>] [--json]
  teler data list --project <id> [--query <text>] [--limit <n>] [--offset <n>] [--org <id>] [--json]
  teler data describe <ref> --project <id> [--limit <n>] [--offset <n>] [--org <id>] [--json]
  teler run python --file <code.py> --project <id> --max-credits <amount> --idempotency-key <key>
             [--chat <id>] [--org <id>] [--execution-timeout <seconds>] [--wait --timeout <seconds>] [--json]
  teler data query --file <query.sql> --project <id> --max-credits <amount> --idempotency-key <key>
             [--row-limit <n>] [--chat <id>] [--org <id>] [--execution-timeout <seconds>] [--wait --timeout <seconds>] [--json]
  teler artifact create --file <chart.json> --project <id> --max-credits <amount> --idempotency-key <key>
             [--chat <id>] [--org <id>] [--execution-timeout <seconds>] [--wait --timeout <seconds>] [--json]
  teler run get|cancel <run-id> [--org <id>] [--json]
  teler run wait <run-id> [--org <id>] [--timeout <seconds>] [--json]
  Run submissions require a stable 16–128 character idempotency key. Reuse it only for the same task.
  --execution-timeout bounds sandbox execution (1–120s); --timeout only bounds local waiting.
  --wait --json emits an accepted receipt and a terminal receipt as newline-delimited JSON.
  teler auth login [--device-file <absolute-path>]
  teler auth status [--json]
  teler auth logout
  teler agent-access show [--org <id>] [--json]
  teler agent-access set --preset ask [--org <id>] [--json]
  teler chat list [--limit <count>] [--json]
  teler chat show <chat-id-or-url> [--json]
  teler chat artifacts <chat-id-or-url> [--json]
  teler sync <folder> --to <remote-path> [--org <id>] [--once] [--dry-run] [--json]
  teler sync list|status|pause|resume|remove|stop|daemon [id] [--json]
  teler upload <local-file> [--org <id>] [--to <path>] [--scope personal|organization]
             [--project <id>] [--wait] [--timeout <seconds>] [--json]
  teler upload list [--org <id>] [--status <status>] [--limit <count>] [--json]
  teler upload status <job-id> [--wait] [--timeout <seconds>] [--json]
  teler files list [--path <path>] [--query <text>] [--kind <kind>] [--scope <scope>]
             [--limit <count>] [--offset <count>] [--org <id>] [--json]
  teler files read <path>... [--org <id>] [--json]
  teler files search <query> [--path <path>] [--scope <scope>] [--limit <count>]
             [--org <id>] [--json]
  teler files write <path> <content> [--org <id>] [--json]
  teler files mkdir <path> [--org <id>] [--json]
  teler files move <from> <to> [--org <id>] [--json]
  teler files copy <from> <to> [--org <id>] [--json]
  teler post list [--org <id>] [--project <id>] [--limit <count>] [--cursor <cursor>] [--json]
  teler post get <post-id> [--include metadata|data|both] [--org <id>] [--json]
  teler dashboard list [--org <id>] [--project <id>] [--limit <count>] [--cursor <cursor>] [--json]
  teler dashboard get <dashboard-id> [--include metadata|data|both] [--widget-ids <csv>] [--org <id>] [--json]
  teler post|dashboard create --file <json-file> [--org <id>] [--json]
  teler post|dashboard update <id> --file <json-file> [--org <id>] [--json]
  teler post|dashboard delete <id> --yes [--org <id>] [--json]
  teler post|dashboard move <id> --file <json-file> [--org <id>] [--json]
  teler dashboard refresh <id> [--org <id>] [--json]
  teler post generate <id> --file <json-file> [--org <id>] [--json]
  teler artifact source <artifact-id> [--org <id>] [--json]
  teler artifact get <artifact-id> --chat <chat-id-or-url> [--slug <slug>] [--download --output <file>] [--json]
  teler post artifact <post-id> <artifact-id> [--download --output <file>] [--org <id>] [--json]
  teler post document <post-id> <document-id> [--cursor <cursor>] [--max-bytes <n>] [--page-number <n>] [--anchor <anchor>] [--org <id>] [--json]
  teler post comments|comment|delete-comment|mark-comments-seen <post-id> [options]
  teler post react|unreact|hide|unhide|visibility|export <post-id> [options]
  teler dashboard shares|share|unshare|public-links|create-public-link|revoke-public-link <id> [options]
  teler dashboard activity|create-post <id> [options]
  teler dashboard templates|from-template|template-progress [options]
  Resource writes accept --file <json-file>; deletions/revocations require --yes.
  PDF export requires --file <html-request.json> --output <file.pdf>.
  teler dashboard create --name <name> [--org <id>] [--refresh-interval <interval>] [--json]
  teler dashboard add-widget <id> --artifact <id> --position <json> [--idempotency-key <key>] [--json]
  teler dashboard update <id> --refresh-interval 1m|5m|15m|30m|1h|4h|1d [--json]
  teler dashboard approve-refresh <id> [--approve <capability,...>] [--json]
  teler dashboard archive <id> --yes [--json]
  teler schedule create --agent <id> --frequency daily|weekly|monthly --time-utc <HH:MM> [--org <id>]
             [--project <id>] [--approve <capability,...>] [--json]
  teler schedule approve <id> [--approve <capability,...>] [--json]
  teler schedule list [--org <id>] [--json]
  teler schedule update <id> [--project <id>] [--frequency <cadence>] [--time-utc <HH:MM>] [--json]
  teler schedule pause|resume|history <id> [--json]
  teler schedule delete <id> --yes [--json]
  teler skill  list|get|create|update|delete [options] [--json]
  teler memory list|get|create|update|delete [options] [--json]
  teler agent  list|get|create|update|delete [options] [--json]
  teler send (--chat <chat-id-or-url> | --new) [--org <id>] [--model-set lite|pro]
             [--title <title>] [--deep] [--wait] [--timeout <seconds>] [--json]
             [--metadata-only] "message"
  teler steer <chat-id-or-url> [--timeout <seconds>] [--json] "message"
  teler approval respond <chat-id-or-url> <approval-id> (--allow | --deny)
             [--org <id>] [--wait] [--timeout <seconds>] [--json]
  teler task watch <chat-id-or-url> <task-id> [--timeout <seconds>] [--json] [--metadata-only]
${RESOURCE_USAGE}`

/** Writes `--help` or `--version` output; false for any other command. */
export function writeInfo(
  args: readonly string[],
  json: boolean,
  write: (text: string) => void
): boolean {
  const [first] = args
  if (first === undefined || first === '--help' || first === '-h' || first === 'help') write(USAGE)
  else if (first === '--version' || first === 'version')
    write(json ? `${JSON.stringify({ version })}\n` : `teler ${version}\n`)
  else return false
  return true
}
