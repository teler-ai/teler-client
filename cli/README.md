# Teler CLI

The `teler` CLI works with your Teler account through Teler's authenticated HTTP
API.

## Install and update

Each [release](https://github.com/teler-ai/teler-client/releases) (tags `cli-v…`)
has standalone executables that include the Bun runtime: `teler-mac-arm64`,
`teler-mac-x64`, `teler-linux-x64`, `teler-linux-arm64` and `teler-win-x64.exe`.
Download the one for your computer, check it against `SHA256SUMS.txt`, rename it
to `teler` (`teler.exe` on Windows), make it executable and put it on your `PATH`.
On macOS, a file downloaded with a browser is quarantined; run
`xattr -d com.apple.quarantine teler` before the first start.

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

`--execution-timeout` limits execution to 1–120 seconds (default 60).
`--timeout` only limits local waiting; it never cancels a dispatched run.
`--wait --json` emits an initial receipt and a terminal receipt as NDJSON. Keep
the run ID for `run get`, `run wait`, or `run cancel`. Receipts include the chat,
status, charged credits, bounded output, and artifact IDs/slugs. A `reconciling`
run is still being settled and can still hold credits.

SQL returns bounded JSON rows with `truncated`; data metadata uses `nextOffset`.
The CLI never fetches all pages implicitly. Python can use Teler's chart helpers
and read the project's data; it cannot write persistent files or tables or reach
the web. Use `--chat <id>` to reuse your own chat in
the same project; otherwise the run creates a private analysis chat.

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
their required fields. Imported artifacts retain their supplied snapshot when
rerun. Existing dashboard commands can pin the returned chart artifact.
Artifact inspection omits physical storage details. Downloads are capped at
32 MiB and never overwrite an existing destination.

With `--json`, failures emit `{ "error": { "code", "message", "retryable" } }`
on stderr and return a nonzero exit code. Transient errors include
`retrySafety: "read-or-idempotent-only"`: retry writes only with the same
idempotency key. Exit code 2 denotes invalid command input; 1 denotes an
operation failure. Successful inspection of a failed run remains exit code 0;
waiting for a failed or cancelled run returns exit code 1.

## Dashboards and Agent schedules

Dashboard commands use the same API as the Teler web app. Use exact IDs returned
by prior commands or `chat artifacts`; widgets keep the usual artifact access
checks and the dashboard's four-column grid.

```sh
teler dashboard create --name "Daily overview" --refresh-interval 5m --org <org-id> --json
teler dashboard add-widget <dashboard-id> --artifact <artifact-id> \
  --position '{"x":0,"y":0,"w":4,"h":3}' --idempotency-key overview.chart.1 --json
teler dashboard update <dashboard-id> --refresh-interval 5m --json
teler dashboard list --org <org-id> --limit 20 --offset 0 --json
teler dashboard get <dashboard-id> --org <org-id> --json
teler dashboard archive <dashboard-id> --yes --json
```

Create also accepts `--description`, `--project`, and
`--visibility private|organization`. Omitted `--org` uses the active organization.
Supported refresh intervals are `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, and `1d`;
Teler checks that the organization's plan allows the interval.
List/get JSON includes `refreshInterval` and `lastRefreshedAt`. Get also includes
each widget's `refreshState`: `status`, `lastAttemptAt`, `lastSuccessAt`, and a
static `errorReason` category. A refresh paused because the dashboard owner has no
credits reports `status: "error"` with `pausedReason: "no_credits"` and a `null`
`errorReason`. A failed attempt preserves the previous successful timestamp. Missing legacy observation fields remain `null`; `lastRefreshedAt`
alone does not prove success. Refreshes run on Teler's normal schedule; the CLI
only reports them.

Agent schedules use real daily, weekly, or monthly recurrence at a UTC time.
They require a ready Agent, membership in the organization, and a plan that
includes schedules; the same setup, approval and quota rules as in the web app apply.

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

Tokens remain bound to their granted organizations on collection, mutation,
widget, and history routes. Pause, archive and delete provide ordinary cleanup.

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
