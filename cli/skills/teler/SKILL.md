---
name: teler
description: Work with an organization's data in Teler (teler.ai) through the `teler` CLI. Find projects and tables, run SQL or Python on them in Teler's sandbox, ask Teler's analyst agent, put charts on dashboards and posts, and schedule Teler Agents. Use when a task needs data or results that live in Teler.
---

# Teler CLI

Add `--json` to every command and read stdout. `teler schema --json` lists all commands;
`teler schema <command> --json` (for example `run.python`) gives its flags and inputs.

## Sign in

- `teler auth status --json` checks the sign-in. Otherwise ask the person to run
  `teler auth login` (it shows a code to approve in a browser).
- Headless Linux without a keyring: `TELER_CREDENTIAL_STORE=file teler auth login`, or the
  person sets `TELER_TOKEN`. Never print, log or store a token yourself.

## Find data

```sh
teler project list --json
teler data list --project <project-id> --json                  # tables; page with --offset <nextOffset>
teler data describe <table-ref> --project <project-id> --json  # columns
```

## Run SQL or Python

```sh
teler data query --file query.sql --project <project-id> --max-credits 1 \
  --idempotency-key <key> --wait --json
teler run python --file analysis.py --project <project-id> --max-credits 1 \
  --idempotency-key <key> --wait --json
```

- Runs cost credits and need a paid plan. `--max-credits` caps the cost (at most 100).
- The key is 16–128 characters of `A-Z a-z 0-9 . _ : -`, unique per task.
- SQL: one `SELECT`; `--row-limit` up to 1000 rows.
- Python reads the project's tables through DuckDB:
  `from teler import get_connection; df = get_connection().sql("SELECT * FROM <table-ref>").df()`.
  `teler.execute(sql)` only runs INSERT, UPDATE or DELETE on organization tables, and only where
  the person's Agent Access allows it. No internet access.
- `--execution-timeout <seconds>` (default 60) bounds the run, up to the plan's limit.
  `--timeout` only bounds waiting; the run continues and `teler run get <run-id> --json` reads it.
- `--wait --json` prints NDJSON: an accepted receipt, then a terminal one with `status`,
  `output`, `chargedCredits` and `artifacts` (chart IDs).

## When something fails

- Exit code 2 is invalid input, 1 a failure. With `--json`, stderr holds
  `{"error":{"code","message","retryable","hint"}}`: follow `hint`.
- A failed run has `errorCode`; `execution_failed` comes with the traceback in `errorDetail`. A receipt with a `limit` object
  (`kind` `memory_limit`, `time_limit` or `gpu_needed`) means the run needs more than the sandbox
  allows: tell the person, and give them the receipt's `hint` (it names where to contact sales).
- The same idempotency key returns the same run. Reuse it to recover after a network error or a
  timeout; after fixing code, submit with a new key.
- `retryable: true`: wait `retryAfterMs`, then repeat reads, or writes with the same key.

## Ask Teler's analyst

```sh
teler send --new --wait --json "Which regions grew fastest last quarter?"
teler send --chat <chat-id> --wait --json "Break that down by product."
```

The `task.result` event holds the final answer; it replaces the streamed text.

## Share and automate

- Dashboard: `teler dashboard create --name "<name>" --json`, then
  `teler dashboard add-widget <dashboard-id> --artifact <artifact-id> --position '{"x":0,"y":0,"w":2,"h":2}' --json`.
- Post: `teler post create --file post.json --json` (inputs: `teler schema post.create --json`).
- Teler Agents: `teler agent list --json`; schedule one with
  `teler schedule create --agent <agent-id> --frequency daily --time-utc 09:00 --json`.

## Clean up

Each run without `--chat <chat-id>` creates a chat. Reuse one chat with `--chat`, and delete
chats you no longer need: `teler chat delete <chat-id> --yes --json` (permanent).
