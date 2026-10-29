# Teler CLI

The `teler` CLI works with your Teler account through Teler's authenticated HTTP
API. Add `--json` for machine-readable output; `teler schema --json` lists every
command, and `teler schema <command> --json` gives one command's usage, flags and,
for typed commands, its input schema.

## What it can do

| Area                             | Commands                                                                                                                                                            | Section                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Sign-in, updates, discovery      | `auth login\|status\|logout`, `update`, `--version`, `schema`                                                                                                       | [Sign-in and organizations](#sign-in-and-organizations)                                                    |
| Coding agents                    | `agent setup`                                                                                                                                                       | [Coding agents](#coding-agents)                                                                            |
| Data and SQL                     | `project list`, `data list\|describe\|query`                                                                                                                        | [Data analysis from an agent](#data-analysis-from-an-agent)                                                |
| Python runs and charts           | `run python\|get\|wait\|cancel`, `artifact create\|get\|source`                                                                                                     | [Data analysis from an agent](#data-analysis-from-an-agent)                                                |
| Teler Files                      | `files list\|read\|search\|write\|mkdir\|move\|copy\|delete\|restore\|trash`                                                                                        | [Teler Files](#teler-files)                                                                                |
| Uploads and folder sync          | `upload`, `upload list\|status`, `sync`, `sync list\|status\|pause\|resume\|retry\|remove\|stop\|daemon`                                                            | [Chat results and uploads](#chat-results-and-uploads), [Folder sync](#folder-sync)                         |
| Teler's analyst and chats        | `send`, `steer`, `task watch`, `approval respond`, `chat list\|show\|artifacts\|seen\|delete`                                                                       | [Chat results and uploads](#chat-results-and-uploads), [Approvals and steering](#approvals-and-steering)   |
| What runs and waits for you      | `status`, `watch`, `notifications`, `agent runs`                                                                                                                    | [What runs and what waits for you](#what-runs-and-what-waits-for-you)                                      |
| Dashboards                       | `dashboard list\|get\|create\|add-widget\|update\|refresh\|approve-refresh\|archive\|delete\|move`, templates, sharing                                              | [Dashboards and Agent schedules](#dashboards-and-agent-schedules), [Posts and sharing](#posts-and-sharing) |
| Posts                            | `post list\|get\|create\|generate\|update\|delete\|move\|visibility`, comments, reactions, `post export`                                                            | [Posts and sharing](#posts-and-sharing)                                                                    |
| Teler Agents and their schedules | `agent list\|get\|create\|update\|delete\|run\|spend-cap\|allow-and-rerun\|apply-skipped`, `schedule create\|approve\|list\|update\|pause\|resume\|history\|delete` | [Teler Agents](#teler-agents), [Dashboards and Agent schedules](#dashboards-and-agent-schedules)           |
| Code Files and File schedules    | `files save-code\|run\|result\|runs\|output`, `schedule file create\|show\|quote\|approve\|pause\|resume\|re-pin\|runs\|latest\|delete`                             | [Code Files and File schedules](#code-files-and-file-schedules)                                            |
| Personal knowledge               | `skill list\|get\|create\|update\|delete`, `memory list\|get\|create\|update\|delete`                                                                               | [Personal Knowledge](#personal-knowledge)                                                                  |
| Agent Access                     | `agent-access show\|set`                                                                                                                                            | [Sign-in and organizations](#sign-in-and-organizations)                                                    |

## Install and update

Each [release](https://github.com/teler-ai/teler-client/releases) (tags `cli-v…`)
has standalone executables that include the Bun runtime: `teler-mac-arm64`,
`teler-mac-x64`, `teler-linux-x64`, `teler-linux-arm64` and `teler-win-x64.exe`.
Download the one for your computer, check it against `SHA256SUMS.txt`, rename it
to `teler` (`teler.exe` on Windows), make it executable and put it on your `PATH`.
From 0.1.1, the macOS executables are signed with Teler's Developer ID and
notarized by Apple, so macOS opens them without a warning. With 0.1.0, a file
downloaded with a browser is quarantined; run `xattr -d com.apple.quarantine teler`
before the first start.

```sh
teler --version
teler update --check   # is there a newer release?
teler update           # download, verify and install it
```

`teler update` replaces the executable with the newest stable release for your
platform after checking it against the release's `SHA256SUMS.txt`. A release
build also checks for a new release once a day when you run it in a terminal
and mentions it on stderr. It never checks for `--json` output, in CI, for
Teler Desktop's sync helper or with `TELER_NO_UPDATE_CHECK=1`.

In a checkout, after `bun install`, run it from this package's directory, and
compile a release executable for this machine into `release/`:

```sh
bun src/index.ts --help
bun scripts/compile.ts
```

Releases are published by the manual **Publish teler CLI release** workflow
(`.github/workflows/cli-release.yml`) from `main`: `nightly` publishes
`cli-v<version>-nightly.<run>` as a prerelease, and `stable` requires the version
input to equal `package.json`'s `version`. A release also carries the package
tarball (`teler-ai-cli-<version>.tgz`) for programs that use the CLI as a library
with Bun. Nothing is published to a package registry.

`TELER_URL` selects the origin (default `https://app.teler.ai`). For an origin
behind Cloudflare Access, set `TELER_ACCESS_TOKEN` to an Access token (for
example `cloudflared access token -app=$TELER_URL`); the CLI sends it as
`cf-access-token`, only to that origin.

## Sign-in and organizations

```sh
teler auth login           # approve a code in a browser
teler auth status --json   # the signed-in account on the selected origin
teler auth logout          # revoke the sign-in and remove it from this computer
```

The sign-in is kept in the system keyring. On a Linux host without one (no
`secret-tool`), `TELER_CREDENTIAL_STORE=file teler auth login` keeps it in a
private file; `TELER_TOKEN` provides a token without storing it. A sign-in is bound
to the origin that issued it. Commands use the session's active organization;
`--org <org-id>` selects another for one command.

Agent Access is your policy for what agents may do on your behalf without asking,
such as changing tables or files. `teler agent-access show --json` reads it,
including which `preset` it is (or `custom`). `teler agent-access set --preset
<preset> --json` sets one of the presets the app offers: `standard` (reads data,
asks before web access and changes), `ask` (asks before everything),
`read-only` (reads, never changes) or `allow-everything` (never asks; needs
`--yes`). Chat overrides are kept.

## Coding agents

`teler agent setup` teaches Claude Code and Codex to use Teler. It installs the
Teler skill folder (`skills/teler/` in this package) where they look for skills: a
short `SKILL.md` with the core loop and safety rules (credit caps, idempotency keys,
`--yes`), and a guide per area in `references/` (data and queries, runs and code
Files, File schedules, outputs, Agents and chats, auth and access).

| Agent       | Your user folder (default)  | A project (`--project <dir>`) |
| ----------- | --------------------------- | ----------------------------- |
| Claude Code | `~/.claude/skills/teler/` ¹ | `<dir>/.claude/skills/teler/` |
| Codex       | `~/.agents/skills/teler/`   | `<dir>/.agents/skills/teler/` |

¹ `$CLAUDE_CONFIG_DIR/skills/teler/` when `CLAUDE_CONFIG_DIR` is set.

```sh
teler agent setup                  # both agents, user folders
teler agent setup --codex --project .
teler agent setup --dry-run        # what it would write
teler agent setup --print          # every file, each under a ==> path <== header
```

It never uses the network, prints where it installs each skill (`--json` lists
every file), and is safe to repeat: it reports `unchanged` when nothing changed,
updates a copy it wrote earlier, including removing a guide that copy had and this
version does not, and keeps a copy you changed (any of its files) unless you pass
`--force`. Files you add to the folder yourself are left alone. `teler auth login`
suggests it after you sign in; nothing is installed for you.

The skill in your user folders stays current by itself. After you update the
CLI, the next `teler` command refreshes a copy an older `teler agent setup`
wrote, offline and without output, once per CLI version. A copy you changed is
kept; run in a terminal without `--json`, `teler` says so once on stderr, and
`teler agent setup --force` replaces it. A copy installed with `--project` is
not tracked; re-run `teler agent setup --project <dir>` there after an update.
`TELER_NO_SKILL_SYNC=1` turns the refresh off.

The same skill is also packaged as a Claude Code and Codex plugin in
[`plugins/teler`](../plugins/teler/). Use the plugin or `teler agent setup`, not
both.

On a Linux host without a system keyring (no `secret-tool`), sign in with
`TELER_CREDENTIAL_STORE=file teler auth login`, which keeps the sign-in in a
private file, or provide `TELER_TOKEN`. `teler schema --json` lists every
command with its usage; typed commands also give their input schema and which
flag sets each field.

## Chat results and uploads

```sh
teler send --chat <chat-id> --wait --json "Analyze sales"
teler task watch <chat-id> <task-id> --timeout 180 --json
teler upload ./sales.csv --org <org-id> --wait --timeout 120 --json
teler upload status <job-id> --wait --json
```

Chat waiting commands emit NDJSON. `task.update` events contain streaming deltas.
On completion, `task.result` contains the authoritative assistant message as
`{ chatId, taskId, messageId, content }`, including approval cards. Replace the
accumulated deltas with this snapshot; do not append it. The successful terminal
`task.update` follows reconciliation. The same rule applies to
`approval respond --wait --json`. Standalone `task watch` requires a server that
includes the message ID in terminal events to recover the final snapshot.
Reconciliation uses `GET /api/chat/<chat-id>?messageId=<message-id>`; recovering
older tasks beyond the chat's latest message page requires a server supporting
this exact-message filter.
`--metadata-only` omits content and never fetches the final message.

Human output appends missing text and identifies any final answer that replaces
the streamed version. Pending approvals include a command to respond.

An upload emits `{ jobId, status }` as soon as byte transfer is accepted. With
`--wait --json`, the final status is a second NDJSON record. If waiting times out,
keep the first receipt and resume with `upload status`; the accepted upload
continues on the server.

## Approvals and steering

```sh
teler approval respond <chat-id> <approval-id> --allow --wait --json   # or --deny
teler steer <chat-id> "Use only last year's orders." --json
```

A turn that stops for your approval shows `awaiting_approval`; `approval respond`
answers one pending approval and, with `--wait`, follows the resumed turn.
`steer` adds guidance to a turn that is still running.

## What runs and what waits for you

```sh
teler status --org <org-id>                 # running chats and Agents, unseen finished chats, unread notices
teler watch --org <org-id> --interval 15    # one line per turn, run or notice that starts or ends
teler watch --json --timeout 600            # NDJSON: a `status` record, then `chat.started`,
                                            # `chat.finished`, `agent_run.started`, `agent_run.finished`,
                                            # `notification` events
teler chat seen <chat-id>                   # the finished turn no longer waits for you
teler agent runs --org <org-id> --active    # the member's Agent runs (`--agent <id>` filters)
teler notifications --org <org-id> [--all]  # the unread notifications of one organization
```

`status` and `watch` read `GET /api/attention`, one cheap owner-scoped read. `watch` reads every
15 s (5 s while something runs) and passes the previous cursor as `since`, so a turn that starts
and ends between two reads is still reported; nothing is reported twice. `send --wait` and
`task watch` mark the chat seen once they have printed its result, except with `--metadata-only`.
A turn that stopped to ask for your approval shows the state `awaiting_approval` instead of
`completed` (`awaitingApproval: true` in JSON) until you answer it or the approval expires.
A server without this read answers 404: update it first.

## Teler Files

```sh
teler files list --path /organization --json
teler files search "churn definition" --json
teler files read /organization/notes/metrics.md --json
teler files write /personal/notes/summary.md "Text" --json
teler files mkdir /personal/notes --json
teler files move <from> <to> --json
teler files copy <from> <to> --json
teler files delete /personal/notes/summary.md --yes
teler files trash --json
teler files restore <file-id>
```

Teler Files holds personal (`/personal/…`) and organization (`/organization/…`)
files. `list` filters with `--path`, `--query`, `--kind` and `--scope` and pages
with `--limit`/`--offset`; `search` narrows with `--path`, `--scope` and `--limit`.
Changes follow your Agent Access policy.

`delete` takes a File's path or ID and moves it to the trash, as Delete does in
the Teler app: it prints until when it can be restored, and `restore <file-id>`
brings it back. `trash` lists what is there, with that time, paged with
`--limit`/`--offset`. Who may delete a File is the same as in the app: its owner
for a personal File, its uploader or an organization owner or admin for an
organization File. The CLI never deletes permanently and never deletes a folder;
both are done in the Teler app.

## Teler Agents

A Teler Agent is a saved set of instructions Teler runs on demand or on a schedule.

```sh
teler agent list --json
teler agent create --name weekly-sales --label "Weekly sales" --content-file agent.md --json
teler agent update <agent-id> --content-file agent.md --model-set pro --json
teler agent get <agent-id> --json
teler agent delete <agent-id> --yes --json
```

`create` and `update` also take `--description`, `--model-set lite|pro`,
`--output none|private_post`, `--quick-action`/`--no-quick-action` and
`--capabilities <capability,...>`; `create` takes `--scope personal|organization`.
Schedule an Agent with `teler schedule create` (below).

```sh
teler agent run <agent-id> --idempotency-key <key> --prompt "Only last week" --json
teler agent spend-cap <agent-id> --monthly-credits 50 --yes --json
teler agent runs --agent <agent-id> --json
teler agent allow-and-rerun <run-id> --json
teler agent apply-skipped <run-id> <n> --json
```

`agent run` starts an Agent now, as Run now in the app does, and costs credits
the same way. It needs `--idempotency-key <key>` (16 to 128 characters): the same
key sent again starts nothing new, so retry a lost answer with the same key. It
takes `--project <id>` and `--approve <capability,...>` for what the Agent asks
for. `agent spend-cap` reads, or with `--monthly-credits <n> --yes` or `--none`
sets, how many credits a month of File schedule spend your personal Agent may
approve for you.

A scheduled run that needed something it asks for first, with nobody there,
skips it and goes on. `agent runs --json` lists those in each run's
`skippedActions` and `askSkipped`. `agent allow-and-rerun <run-id>` allows them
(or only `--capabilities <capability,...>`) for that schedule's runs and starts
a run now. `agent apply-skipped <run-id> <n>` applies the alert recipients a run
kept for you, where `<n>` is the action's place in `skippedActions`, from 0.

## Personal Knowledge

Every `memory` command accepts `--org <org-id>` to select the organization.
Omission uses the login session's active organization. Explicit selection requires
a server supporting the `organizationId` query on memory endpoints.

The `skill` commands manage Knowledge entries: how to do a kind of task. `skill create`
creates personal Knowledge entries (`--scope personal`). Organization Knowledge
entries require a reviewed copy: create a personal entry, then submit it for
review from Knowledge in the Teler app. Existing organization entries remain
available to the read and update commands according to the member's permissions.

## Data analysis from an agent

Discover the command input contracts offline, then use exact project and table references:

```sh
teler schema --json
teler schema data.describe --json
teler project list --json
teler data list --project <project-id> --limit 20 --json
teler data describe organization.sales --project <project-id> --json
teler data query --file query.sql --project <project-id> --row-limit 100 \
  --max-credits 1 --idempotency-key sales-query-000001 --wait --json
teler run python --file analysis.py --project <project-id> \
  --max-credits 1 --idempotency-key sales-chart-000001 --wait --json
teler run get <run-id> --json
teler run wait <run-id> --timeout 180 --json
teler run cancel <run-id> --json
```

SQL and Python execute directly in a fresh sandbox, using the current member's
project data access. Each task needs an explicit credit maximum (greater than
zero, at most 100) and a stable 16–128 character idempotency key. Preflight checks
how the run will be funded. Identical retries recover the existing run before
quoting credits; changing the task with the same key fails with a conflict.
There is one execution attempt, with no automatic replay after a worker failure.

`--execution-timeout` limits execution to 1–3600 seconds (default 60); your
organization's plan sets the actual maximum, and Teler refuses a longer run with
`TIME_LIMIT_EXCEEDED`, naming the limit. `--timeout` only limits local waiting; it
never cancels a dispatched run. Without it, `--wait` waits for the execution limit
plus two minutes (at least 180 seconds).
`--wait --json` emits an initial receipt and a terminal receipt as NDJSON. Keep
the run ID for `run get`, `run wait`, or `run cancel`. Receipts include the chat,
status, charged credits, bounded output, and the IDs and slugs of the charts, tables and files it made (`artifacts`). A `reconciling`
run is still being settled and can still hold credits.

SQL returns bounded JSON rows with `truncated`; data metadata uses `nextOffset`.
The CLI never fetches all pages implicitly. Use `--chat <id>` to reuse your own
chat in the same project; otherwise each run creates a private analysis chat.
Delete chats you no longer need with `teler chat delete <chat-id> --yes`; deletion
is permanent.

Python can use Teler's chart helpers and read the project's data through DuckDB:

```python
from teler import get_connection

con = get_connection()
df = con.sql("SELECT region, sum(amount) AS total FROM organization.sales GROUP BY 1").df()
print(df.head())
```

`get_connection()` is for reading. `teler.execute(sql)` only runs `INSERT`,
`UPDATE` or `DELETE` on an organization table. Runs cannot reach the web.

### Capabilities and approval

Without `--capabilities`, a run holds what your Agent Access settings allow
without asking, and leaves out what they ask about first. Under the default
Standard settings, reading data is allowed and every change asks, so code that
saves a File (for example a model with `teler.models.save`) or changes a table
needs `--capabilities`:

```sh
teler run python --file train.py --project <project-id> --max-credits 1 \
  --idempotency-key churn-model-000001 \
  --capabilities tables.metadata.read,tables.rows.read,files.create --wait --json
```

`--capabilities` (also on `data query` and `artifact create`) lists exactly what
the run may use, so it includes the reads the code needs. The capabilities a run
can name are:

- reads: `tables.metadata.read`, `tables.rows.read`, `files.metadata.read`,
  `files.content.read`, `connectors.discover` and `connectors.query`;
- changes: `files.create`, `files.update`, `files.copy`, `files.move`,
  `files.delete`, `tables.create`, `tables.rows.write`, `tables.schema.update`,
  `tables.copy`, `tables.move` and `tables.delete`.

A copy also needs what it reads and creates; a move, what it creates.

What your settings deny refuses the run (`CAPABILITY_DENIED`). What they ask
about holds it as `needs_approval`, with no sandbox started, until you answer
in the Teler app:

- **The approval link.** The receipt has an `approval` object (`requestId`,
  `expiresAt`, the capabilities it asks about) and, from the CLI, `approvalUrl`
  and a `hint`. Plain output prints one line,
  `Approve <capabilities> in the Teler app: <url> (by <time>)`. The request also
  reaches your notifications.
- **Approving.** Only a browser signed in as you can approve it, never the CLI.
  Approve this run once, or always, which saves an allow rule in your Agent
  Access. A high-risk change, or one your organization wants approved each time,
  can only be approved once.
- **Waiting.** With `--wait`, the CLI keeps reading the run while it waits (every
  five seconds). Without `--timeout`, it waits up to 15 more minutes for your
  answer; `run wait` does the same.
- **After your answer.** An approved run starts. One you deny, or whose request
  expires, ends `cancelled`.

Changing your settings between the request and your answer replaces the
request, or ends the run when a capability becomes denied.

A failed run without `--capabilities` names, in its `hint`, what it left out
because your settings ask about it first. A SQL query whose row reads ask first
is refused with `CAPABILITY_APPROVAL_REQUIRED`; send it again with
`--capabilities tables.rows.read`. These need a server that supports run
capabilities; older servers refuse the field.

A failed run reports `errorCode`. When your own code raised (`execution_failed`),
servers that support it also return the traceback, with secrets redacted, as
`errorDetail`; plain output prints it after the receipt. Fix the code and submit
it with a new idempotency key: the same key returns the failed run.

When the server reports that a run stopped at a limit of the sandbox (a `limit`
object whose `kind` is `memory_limit`, `time_limit` or `gpu_needed`), the commands
that submit a run or wait for it (`run python`, `data query`, `artifact create`,
`run wait`) say in plain output that the run needs more compute or a GPU, and
where to ask (`Contact sales: https://teler.ai/contact?topic=sales`), with the
same exit status as any failed run. With `--json`, every receipt of that run,
including `run get`, keeps `errorCode`, passes `limit` through, and adds a `hint`
string with the same contact link. A run that only reached its own
`--execution-timeout` has no `limit` and is reported as before.

The `artifact` commands work on what a run or chat made: charts, tables, models
and data files. `teler chat artifacts` lists them with their IDs and slugs.

Create a chart from an explicit static data snapshot:

```json
{
  "type": "bar",
  "title": "Revenue",
  "x": "month",
  "y": "revenue",
  "data": [{ "month": "Jan", "revenue": 120 }]
}
```

```sh
teler artifact create --file chart.json --project <project-id> \
  --max-credits 1 --idempotency-key imported-chart-001 --wait --json
teler artifact get <artifact-id> --chat <chat-id> --slug <slug> --json
teler artifact get <artifact-id> --chat <chat-id> --slug <slug> \
  --download --output chart-result.json --json
```

Imported types are `bar`, `line`, `table`, and `metric`; the schema describes
their required fields. Imported charts retain their supplied snapshot when
rerun. Existing dashboard commands can pin the returned chart.
Inspecting a chart or file omits physical storage details. Downloads are capped at
32 MiB and never overwrite an existing destination.

With `--json`, failures emit `{ "error": { "code", "message", "retryable" } }`
on stderr and return a nonzero exit code. When there is a clear next step, the
error also has a `hint` (plain output prints it as a `hint:` line). When Teler's
refusal explains what to do instead, the `hint` is the server's own, unless the
CLI has its own next step for that error, such as retrying with the same
idempotency key. Transient errors include
`retrySafety: "read-or-idempotent-only"`: retry writes only with the same
idempotency key. Exit code 2 denotes invalid command input; 1 denotes an
operation failure. Successful inspection of a failed run remains exit code 0;
waiting for a failed or cancelled run returns exit code 1.

## Dashboards and Agent schedules

Dashboard commands use the same API as the Teler web app. Use exact IDs returned
by prior commands or `chat artifacts`; widgets keep the usual access
checks on the chart or table they show and the dashboard's four-column grid.

```sh
teler dashboard create --name "Daily overview" --refresh-interval 1h --org <org-id> --json
teler dashboard add-widget <dashboard-id> --artifact <artifact-id> \
  --position '{"x":0,"y":0,"w":4,"h":3}' --idempotency-key overview.chart.1 --json
teler dashboard add-widget <dashboard-id> --schedule <schedule-id> --slot result \
  --chart line --x date --y yhat --color category --json   # follows a scheduled File
teler dashboard update <dashboard-id> --refresh-interval on_change --json
teler dashboard list --org <org-id> --limit 20 --json   # next page: --cursor <nextCursor>
teler dashboard get <dashboard-id> --org <org-id> --json
teler dashboard archive <dashboard-id> --yes --json
```

A widget added with `--schedule` follows a scheduled code File: each successful run of the
schedule, or its owner's Run now, redraws its chart. Only the schedule's owner can add one, to
a dashboard in the schedule's project. It takes no idempotency key, so after a lost answer
check `dashboard get` before adding it again.

Create also accepts `--description`, `--project`, and
`--visibility private|organization`. Omitted `--org` uses the active organization.
`--refresh-interval` takes `manual` (refresh only when asked), `on_change`
(refresh only after its data changes), or an interval:
`15m`, `30m`, `1h`, `4h`, `5h` or `1d`. New dashboards are `manual` unless you
choose otherwise. The organization's plan sets the shortest interval, and Teler
refuses a faster one with `PLAN_LIMIT_EXCEEDED` and a `hint` naming the settings
the plan allows. `dashboard refresh <id>` refreshes a dashboard now.

Template creation is asynchronous:

```sh
teler dashboard templates --org <org-id> --json
teler dashboard from-template --file template.json --org <org-id> --json
teler dashboard template-progress --chat <returned-chat-id> --org <org-id> --json
```

`template.json` contains `templateId` from the template list and optionally
`projectId`. The creation receipt contains `dashboard`, `chatId`, and `pending`
jobs with their planned positions; it does not mean the widgets are ready.
Poll `template-progress` until each job settles. For each completed job with an
`artifactId`, use `dashboard add-widget` with the returned dashboard ID, the chart's
ID (`artifactId`), and corresponding pending job's position. Inspect failed or timed-out jobs
before proceeding; a failure placeholder chart is not a successful result.
The CLI does not automatically wait for jobs or pin their charts.

List/get JSON includes `refreshInterval` and `lastRefreshedAt`. Get also includes
each widget's `refreshState`: `status`, `lastAttemptAt`, `lastSuccessAt`, and a
static `errorReason` category. A refresh paused because the dashboard owner has no
credits reports `status: "error"` with `pausedReason: "no_credits"` and a `null`
`errorReason`. A failed attempt preserves the previous successful timestamp. Missing legacy observation fields remain `null`; `lastRefreshedAt`
alone does not prove success. Refreshes run on Teler's normal schedule; the CLI
only reports them.

A dashboard's content (new or reworked charts, filters and analyses) is changed
by asking Teler's analyst with `teler send`, naming the dashboard; `dashboard update
<id> --file <json-file>` changes its settings. `dashboard delete <id> --yes` deletes
one and `dashboard move <id> --file <json-file>` (`{"projectId":"<id>"}`) moves it
to another project.

Agent schedules use real daily, weekly, or monthly recurrence at a UTC time.
They require a ready Agent and membership in the organization; the same setup,
approval and quota rules as in the web app apply.

```sh
teler schedule create --agent <agent-id> --org <org-id> \
  --frequency daily --time-utc 09:00 --json
teler schedule list --org <org-id> --json
teler schedule update <schedule-id> --frequency weekly --day-of-week 1 --time-utc 09:00 --json
teler schedule history <schedule-id> --json
teler schedule pause <schedule-id> --json
teler schedule resume <schedule-id> --json
teler schedule delete <schedule-id> --yes --json
```

Weekly create requires `--day-of-week 0..6` (Sunday is `0`); monthly create
requires `--day-of-month 1..31`. Create/update accept `--prompt`, `--clear-prompt`,
and `--delivery chat|email`. Update changes only the supplied fields. History
returns at most ten occurrences with `scheduledFor`, dispatch `status`, linked
`agentRunId`/`agentRunStatus`, `chatId`, and `taskId`/`taskStatus`. A successful
dispatch can still have a running or failed Agent task. Missing historical links
remain `null`; error text and stored prompts are excluded from CLI schedule JSON.

`schedule list` also lists an Agent's event starts, which start a run without a
time: its table updating (`table_update`), another Agent finishing
(`agent_finished`), or an alert opening on an Agent or a File (`alert_opened`,
with `startAlert` naming it). `update`, `pause`, `resume` and `approve` take
their IDs too. A start of a kind this version does not know yet is left out of
the list; `teler update` shows it.

Tokens remain bound to their granted organizations on collection, mutation,
widget, and history routes. Pause, archive and delete provide ordinary cleanup.

## Posts and sharing

```sh
teler post list --json                                  # page with --cursor <nextCursor>
teler post get <post-id> --json
teler post create --file post.json --json
teler dashboard create-post <dashboard-id> --json
teler post comments <post-id> --json
teler post delete <post-id> --yes --json
```

`post.json` holds the chat the post comes from, its Markdown and the charts and
files it shows (`artifactIds`): `{"chatId":"<chat-id>","title":"Q3 revenue","content":"…","artifactIds":["<artifact-id>"]}`.
`post generate <id> --file <json-file>` has Teler's agent draft a post's content.
`post translate <id> --languages fr,de` has Teler translate your own post's saved text
into other languages: `en`, `ca`, `es`, `fr`, `it`, `de` or `pt`, up to six at a time.
It reports each language as translated, failed with a code (`INSUFFICIENT_CREDITS`,
`TRANSLATION_FAILED`, `ALREADY_IN_LANGUAGE`) or skipped (the post's main language), and
exits non-zero when none was translated. Each language costs credits; translating a
language again replaces its earlier translation, hand edits included. `post get <id>
--include metadata` shows every translation and whether it is out of date. This needs a
server that translates posts; older servers refuse it.
Posts also have `update`, `move`, `visibility`, `artifact`, `document`, `comment`,
`delete-comment`, `mark-comments-seen`, `react`, `unreact`, `hide`, `unhide` and
`export` (a PDF); `teler schema post.<action>` shows each one's usage.

Dashboards are shared with people in the organization, or through public links:

```sh
teler dashboard visibility <dashboard-id> --file visibility.json --json   # {"visibility":"organization"}
teler dashboard share <dashboard-id> --file share.json --json             # {"email":"<email>","permission":"view"}
teler dashboard shares <dashboard-id> --json
teler dashboard unshare <dashboard-id> <share-id> --yes --json
teler dashboard public-links <dashboard-id> --json
teler dashboard activity <dashboard-id> --json
```

`create-public-link` and `revoke-public-link <id> <link-id> --yes` manage public
links; some organizations turn them off, and Teler refuses the request.

## Code Files and File schedules

Code that worked in `teler run python` can run in Teler on a schedule as a code
File: a Python script that Teler's sandbox runs with only its declared inputs,
writing JSON results that your team opens in Teler. These commands need a server
that supports code Files, and a paid plan to run code; older servers refuse them.

A code File reads its parameters and inputs, and saves each output slot, through
`teler.job`:

```python
import json
import joblib, io
import teler.job

params = teler.job.context()["parameters"]
sales = json.loads(teler.job.load_input_bytes("sales"))          # a table: a list of rows
model = joblib.load(io.BytesIO(teler.job.load_input_bytes("model")))  # a model File
teler.job.save_json("result", {"forecast": model.predict(...).tolist()})
```

```sh
# Save the script; an input is <name>=<table-ref> (read in --project) or <name>=file:<file-id>.
teler files save-code score.py --to /personal/jobs/score.py --project <project-id> \
  --input sales=<table-ref> --input model=file:<model-file-id> --json
# Run it once now; this also records what it reads and writes for its schedule.
teler files run <file-id> --project <project-id> --input sales=<table-ref> \
  --input model=file:<model-file-id> --output result --params '{"horizon":4}' \
  --max-credits 2 --idempotency-key score-test-0001 --wait --json
# Schedule it (it starts paused), read the quote, approve a monthly cap.
teler schedule file create <file-id> --frequency daily --time 06:00 --timezone Europe/Madrid \
  --idempotency-key score-daily-0001 --json
teler schedule file quote <schedule-id> --json
teler schedule file approve <schedule-id> --revision <n> --monthly-credits 20 --yes --json
teler schedule file runs <schedule-id> --json
teler schedule file latest <schedule-id> --json
teler schedule file latest <schedule-id> --slot result --output result.json
teler files result <code-run-id> --json
```

`schedule file latest` reads the newest occurrence that started a run, whether
it succeeded or not, and its outputs with their contracts: a dataset's columns,
rows and time coverage, a model's framework, features and output, or a JSON
value. `--json` returns each output's contract; `--slot` with `--output <file>`
saves one to a new file. `files runs` lists your code runs, and
`files output <run-id> <slot>` prints one JSON output or, with `--output`, saves
any output, including a model's bytes. Outputs are readable by the person who
ran or scheduled the File.

`files run` charges at most `--max-credits`. Keep the run ID from its receipt:
repeating an `--idempotency-key` is refused (`RETRY_CONFLICT`) rather than run
twice, so a lost answer can hide a run that is already going.

`files save-code --file <file-id>` saves a new version of the same File. A
schedule keeps the version it was made with until `teler schedule file re-pin`,
which ends its approved spend: quote and approve it again. Without `--output`,
`files run` and `schedule file create` repeat your own last run of the File's
current version, its alert rule included. With several outputs, one must be named
`result`.

A File whose code raises an alert (`teler.job.alert(...)`) alerts by a rule: one
line of up to 280 characters, shown as "Alerts when …". Naming outputs with
`--output` declares the run anew, so pass the rule with it:
`--alert-rule "<rule>"`. Without it the CLI refuses (`ALERT_RULE_REQUIRED`) when
your last run of the File had a rule, instead of dropping the rule. `schedule
file show` prints the rule a schedule alerts by (`alertRule` in `--json`).

A File schedule starts paused. `quote` shows, for the schedule's current
`revision`, the most one run may hold (`--max-run-minutes`, 1 to 30, sets its run
time), the runs expected in a month and a suggested monthly cap. `approve` needs
`--yes`, the `--revision` you read and your own `--monthly-credits`; it approves
the server's quote for exactly that revision, and Teler refuses it (`STALE_QUOTE`
locally, or `STALE_APPROVAL` / `STALE_REVISION`) when anything moved since. Only the
schedule's owner can approve. Approving starts a schedule that was waiting for it.
Runs past the cap, an organization hold, a lost access or repeated failures stop
or skip occurrences as they do in the web app; `runs` shows each occurrence with
its code run and, for a skipped one, a reason code such as `SPEND_CAP_REACHED`.
`pause`, `resume`, `re-pin` and `delete --yes` name the revision they just read,
so a change made meanwhile is refused instead of overwritten. Repeating an
`approve` whose answer was lost reports the approval already in force.

A run of a saved code File does not return its traceback. Debug the same code
with `teler run python` first. A model saved there with `teler.models` becomes a
model File input only where your Agent Access settings allow file changes without
asking; otherwise train the model inside the job from its table inputs.

## Folder sync

Sync keeps analytical inputs fresh with recursive, one-way local → Teler uploads.
It requires an authenticated Teler account and the server's safe sync upload API.

```sh
teler auth login
teler sync ./reports --to /personal/reports
teler sync ./exports --to /organization/exports --org <organization-id>
teler sync ./q3 --to /organization/q3 --org <organization-id> --project <project-id>
teler sync list
teler sync status --json
teler sync pause <registration-id>
teler sync resume <registration-id>
teler sync retry <registration-id>
teler sync remove <registration-id>
teler sync stop
```

The first registration starts one detached daemon for your OS user; subsequent
folders share it. Synced files belong to the organization's default project, or
to the project given with `--project`. Repeating the same folder, origin, account,
organization, destination and project reuses the registration. Relative paths are preserved. Registrations
pin those identities, so switching the active organization cannot redirect work.
An account mismatch or expired login pauses uploads until the matching account
is authenticated again. A temporary failure retries automatically with growing
backoff (up to about four minutes); `sync status --json` shows each waiting
file's `retryAt` and `error` code, and `sync retry <id>` tries them on the next
pass (after any rate limit). When
Teler rate-limits uploads (HTTP 429), no file starts until its `Retry-After`
has passed (`throttledUntil`), because refused requests count against the limit. Credentials stay in the configured credential store;
no credentials are written into the sync database. An environment token is used
only for the origin selected by that process's `TELER_URL`.

The daemon survives terminal closure, watches folders, and rescans every five
seconds to recover missed events and sleep. Local state and private immutable
pending snapshots live in `$XDG_STATE_HOME/teler/sync` (default
`~/.local/state/teler/sync`). Sync never uploads that directory or the file
credential store, at their configured or default locations. Hashes avoid
reingesting unchanged content. Transient
failures retry with bounded backoff. Pending jobs survive daemon restarts.
`status --json` includes `daemonRunning`, registration status, and per-file state.
A stopped daemon's lease can take up to 30 seconds to expire after a crash.

Login services are not installed automatically. After logout/reboot, run any
normal registration command or `sync resume <id>` to start the daemon again.
A supervising application, such as Teler Desktop, sets `TELER_SYNC_DAEMON=managed`
so registration and resume never start a detached daemon; it runs and stops
`teler sync daemon` itself. With `TELER_TOKEN` set, sync uses it for that
origin's folders without opening the OS credential store, so a supervisor can
provide the credential on hosts without one.
A compiled `teler` executable starts its daemon from the same executable.
For your existing service manager use `teler sync daemon` in the foreground;
`teler sync stop` requests and acknowledges a safe stop without deleting registrations; SIGTERM/SIGINT also stop it. Ensure that service has access to the same credential
store and state directory. Detached daemons inherit their launching environment;
restart the daemon when changing `TELER_TOKEN`. File/OS credential store updates
are picked up on each reconciliation.

```sh
# Preview eligible and excluded files without authentication, registration, or writes.
teler sync ./reports --to /personal/reports --dry-run --json

# Reconcile through processing without starting a daemon (default timeout 120s).
teler sync ./reports --to /personal/reports --once --timeout 300
```

`--once` requires the daemon to be stopped with `teler sync stop` and shares its lock. It returns a
nonzero exit status for pending processing after the timeout or for failures;
inspect `sync status` and rerun to continue. The registration is retained. A
normal background registration returns immediately: inspect status to distinguish
pending processing from `ready`. Unsupported, excluded, empty, unstable, and
unreadable files are reported individually.

Local deletion, unavailable roots, pause, and removal never delete remote files.
A file must settle for one second before upload. Changed content is staged and
processed before promotion; failed or partial processing retains the previous
usable remote version. An updated file keeps its identity in Teler. Independent
remote changes and incompatible output shapes
become conflicts. Resolve conflicts deliberately; sync never automatically adopts
a remote revision. Stop tracking with `remove` to discard its pending local
snapshots while leaving uploaded content in Teler.

Uploads in progress use temporary `._teler_sync/` paths in the destination. These
may appear in file listings until the new version is promoted, and count toward
storage quota alongside the previous version. Teler removes abandoned uploads
after a while; a resumed sync starts a fresh upload if its earlier one expired.

Default exclusions include `.git`, dependency/build directories, `.ssh`, `.aws`,
`.codex`, `.agents`, `.env*`, private keys, credential JSON, and temporary files.
Symlinks are skipped. Add a root `.telerignore` with one glob per line:

```text
# Private exports
private/**
*.backup.csv
scratch/
```

Patterns match relative paths; patterns without `/` also match path components.
Blank lines and `#` comments are ignored. Negation (`!`) and nested ignore files
are not supported. An unreadable or symlinked ignore file stops the scan.
Review `--dry-run` before registering sensitive folders; default exclusions are
not a complete secret detector.

Supported candidates include CSV/TSV, Excel/ODS, JSON/JSONL/NDJSON, text/Markdown,
PDF, DOCX, HTML/RTF, and PNG/JPEG/WebP; server support and quotas are authoritative.
Archives are excluded in this first iteration. There is no deletion mirroring,
downloading, or two-way conflict resolution.
