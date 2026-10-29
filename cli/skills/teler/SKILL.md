---
name: teler
description: Work with an organization's data in Teler (teler.ai) through the `teler` CLI. Find projects and tables, run SQL or Python on them in Teler's sandbox, ask Teler's analyst agent, put results on dashboards and posts, and schedule tested Python or Teler Agents. Use when a task needs data, analysis or results that live in Teler.
---

# Teler CLI

Teler holds an organization's data (tables, uploads and files, in projects), chats with Teler's
analyst agent, and what comes out of them: charts, dashboards, posts, code Files and their
schedules, and Teler Agents. The `teler` CLI reaches all of it through Teler's API, signed in
as the person you work for.

## When to use it

- The data, or results built from it, live in Teler.
- The person asks for an analysis, chart, dashboard, post, scheduled job or Teler Agent there.

Analyze data inside Teler (a run, or Teler's analyst) rather than copying it out.

## The loop

1. `teler auth status --json`. If it fails, ask the person to sign in
   ([auth and access](references/auth-and-access.md)).
2. Find the data: `teler project list --json`, then `teler data list --project <id> --json`
   and `teler data describe <table-ref> --project <id> --json`.
3. Answer: ask Teler's analyst (`teler send --new --wait --json "<question>"`), or run your own
   SQL or Python (`teler data query`, `teler run python`).
4. Share: pin charts to a dashboard, or write a post.
5. Automate, once the person agrees: schedule tested Python as a code File, or a Teler Agent.
6. Delete the chats you created and no longer need.

Add `--json` to every command and read stdout; `--wait` commands print NDJSON, one event per
line. `teler schema --json` lists every command; `teler schema <command> --json` (for example
`run.python`) gives its flags and inputs.

## Safety rules

- **Credits.** Runs and dashboard refreshes spend the organization's credits. Every run needs
  `--max-credits`, a cap of at most 100: keep it small. Agree any monthly spend or refresh
  schedule with the person before you approve or set it.
- **Idempotency keys.** Runs (`data query`, `run python`, `artifact create`, `files run`) and
  File schedules take `--idempotency-key`: 16–128 characters of `A-Z a-z 0-9 . _ : -`, new for
  each task. After a network error or timeout, repeat a run with the same key to get the same
  run, never a second one; `files run` refuses a repeated key instead (`RETRY_CONFLICT`), so
  check `teler files runs` first. Changed code needs a new key.
- **`--yes`.** Deleting, revoking and approving spend need `--yes`. Pass it only for what the
  person asked for.
- Never print, log or store a token. Change sharing or Agent Access only when asked.

## When something fails

Exit code 2 is invalid input, 1 a failure. With `--json`, stderr holds
`{"error":{"code","message","retryable","hint"}}`: follow `hint`. When `retryable` is true,
wait `retryAfterMs`, then repeat a read, or a write with the same idempotency key.

## Guides

Read the one the task needs:

- [Data and queries](references/data-and-queries.md): projects, tables, SQL, Files, uploads and folder sync.
- [Runs and code Files](references/runs-and-code-files.md): Python runs, receipts and failures; saving tested code as a code File.
- [File schedules](references/file-schedules.md): run a code File daily, weekly or monthly under an approved monthly cap.
- [Outputs](references/outputs.md): charts, tables and other results, dashboards and posts.
- [Agents and chats](references/agents-and-chats.md): Teler's analyst, approvals, Teler Agents and their schedules, knowledge.
- [Auth and access](references/auth-and-access.md): sign-in, origins, organizations, Agent Access and updates.
