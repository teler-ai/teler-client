# Data and queries

## Find data

```sh
teler project list --json
teler data list --project <project-id> --query sales --limit 50 --json
teler data describe <table-ref> --project <project-id> --json
```

- `data list` returns a project's tables with whether each can be queried and where it came
  from. It pages with `--offset <nextOffset>`; the CLI never fetches every page for you.
- Use each table's `ref` exactly as `data list` returns it, in SQL and Python alike.
- `data describe` lists a table's columns, also paged.

## Query with SQL

```sh
teler data query --file query.sql --project <project-id> --row-limit 100 \
  --max-credits 1 --idempotency-key <key> --wait --json
```

- One `SELECT` per file. Up to `--row-limit` rows come back (at most 1000), with `truncated`
  when there were more: aggregate in SQL rather than paging rows out.
- It is a run like any other: credits, idempotency key, receipts and failures work as in
  [runs and code Files](runs-and-code-files.md).
- Each run without `--chat <chat-id>` creates a chat. Reuse one chat for related runs in the
  same project.

## Teler Files

Teler Files is the organization's file space, under `/personal/…` and `/organization/…`.

```sh
teler files list --path /organization --json
teler files search "churn definition" --json
teler files read /organization/notes/metrics.md --json
teler files write /personal/notes/summary.md "<text>" --json
teler files mkdir /personal/notes --json
teler files move <from> <to> --json
teler files copy <from> <to> --json
teler files delete /personal/notes/summary.md --yes --json
teler files trash --json
teler files restore <file-id> --json
```

Writing, moving, copying and deleting change the person's files: do it only when asked. Their
Agent Access policy decides what may change without asking. `delete` moves a File to the trash
and answers `recoverableUntil`; tell the person, and that `teler files restore <file-id>` brings
it back. The CLI never deletes permanently or deletes a folder: those stay in the Teler app.

## Bring data in

```sh
teler upload ./sales.csv --wait --timeout 120 --json
teler upload status <job-id> --wait --json
teler upload list --json
```

An upload is processed into tables or documents. It is the person's own unless you pass
`--scope organization` (do that only when asked); `--to <folder>` picks a folder in that scope
and `--project <id>` a project. The first NDJSON record has the `jobId`; if waiting times out,
keep it and continue with `upload status`.

`teler sync <folder> --to <remote-path>` keeps uploading a local folder in the background
(one way, local to Teler; it never deletes remote files). Preview first with `--dry-run --json`,
and never point it at a folder with secrets. `sync list|status|pause|resume|retry|remove|stop`
manage it. Supported types include CSV/TSV, Excel/ODS, JSON/JSONL, text and Markdown, PDF,
DOCX, HTML and images.
