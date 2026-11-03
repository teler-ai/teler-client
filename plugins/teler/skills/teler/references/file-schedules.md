# File schedules

A File schedule runs a code File's version daily, weekly or monthly. It starts paused and runs
only after its owner approves a monthly credit cap. Make the File run once by hand first
([runs and code Files](runs-and-code-files.md)): without `--output`, the schedule repeats your
last run of that version.

## Create, quote, approve

```sh
teler schedule file create <file-id> --frequency daily --time 06:00 --timezone Europe/Madrid \
  --idempotency-key <key> --json
teler schedule file quote <schedule-id> --json
# Only after the person has said yes to this quote and cap:
teler schedule file approve <schedule-id> --revision <n> --monthly-credits <cap> --yes --json
```

- Time: `--time-utc <HH:MM>`, or `--time <HH:MM> --timezone <zone>`. Weekly needs
  `--day-of-week 0-6` (0 is Sunday); monthly needs `--day-of-month 1-31`.
- `create` takes the same `--input`, `--output`, `--params` and `--alert-rule` as `files run`.
  A File that alerts keeps its rule when the schedule repeats your last run; with `--output`,
  pass `--alert-rule "<rule>"` or the CLI refuses (`ALERT_RULE_REQUIRED`). `show` prints it.
- `quote` shows, for the schedule's current `revision`, what one run may hold, the runs expected
  in a month and a suggested cap. `--max-run-minutes <1-30>` sets the run time it quotes.
- Approving commits the person's credits, so it is their decision, never yours. Show them the
  quote (the monthly cap, what one run may hold, how often it runs) and ask; run `approve` with
  `--yes` only after they say yes in the conversation. If nobody is there to answer, stop and
  tell them what to approve: the schedule, its revision and the cap.
- Only the schedule's owner can approve. It approves exactly the revision you read; if anything
  changed since, Teler refuses (`STALE_QUOTE`, `STALE_APPROVAL` or `STALE_REVISION`): quote
  again, and ask again if the quote changed.

## Follow it

```sh
teler schedule file show <schedule-id> --json
teler schedule file runs <schedule-id> --json     # last ten occurrences; skipped ones say why
teler schedule file latest <schedule-id> --json   # newest run and its typed outputs
teler schedule file latest <schedule-id> --slot result --output result.json
teler files result <run-id> --json
```

`latest` describes each output: a dataset's columns, rows and time coverage, a model's features,
or a JSON value. A skipped or failed occurrence has a reason code such as `SPEND_CAP_REACHED` and
`reasonText`, the sentence to tell the person.

## Change it

```sh
teler schedule file pause <schedule-id> --json
teler schedule file resume <schedule-id> --json   # its approved spend must still be in force
teler schedule file re-pin <schedule-id> --json   # move to the File's newest version
teler schedule file delete <schedule-id> --yes --json
```

- New code: `teler files save-code <local.py> --file <file-id>`, then `re-pin`. Re-pinning ends
  the approved spend: quote again and ask the person before you approve.
- These commands name the revision they read, so a change made meanwhile is refused rather than
  overwritten. Read the schedule again and retry.
- When a refusal has `reason`, its `hint` gives the next step (approve spend once the person
  agrees, quote again, or ask an organization admin to release a hold).
