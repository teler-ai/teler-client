# Runs and code Files

## Run Python

```sh
teler run python --file analysis.py --project <project-id> --max-credits 1 \
  --idempotency-key <key> --wait --json
```

The code runs in a fresh sandbox with the project's data and no internet access:

```python
from teler import get_connection

df = get_connection().sql("SELECT region, sum(amount) AS total FROM <table-ref> GROUP BY 1").df()
print(df)
```

- `get_connection()` reads through DuckDB. `teler.execute(sql)` runs only `INSERT`, `UPDATE`
  or `DELETE` on organization tables.
- A run holds only what the person's Agent Access allows without asking. To save a File or
  change a table where it asks first, see [changes that need approval](#changes-that-need-approval).
- Charts the code makes come back as results (IDs in the receipt's `artifacts`); see [outputs](outputs.md).
- `--execution-timeout <seconds>` (default 60, up to 3600 or the plan's limit) bounds the run.
  `--timeout` bounds only your waiting: the run goes on.
- Runs cost credits, at most `--max-credits`, and need a paid plan; a refusal's `hint` says what
  to do.

## Changes that need approval

Under the default Standard Agent Access, reading data is allowed and every change asks first, so
code that saves a File (`teler.models.save`, `teler.files`) or changes a table is refused unless
the run asks for it. Name everything the code uses with `--capabilities`:

```sh
teler run python --file train.py --project <project-id> --max-credits 1 --idempotency-key <key> \
  --capabilities tables.metadata.read,tables.rows.read,files.create --wait --json
```

- The list is exact: the run holds only what it names, so include the reads too.
  - Read tables: `tables.metadata.read,tables.rows.read`; read Files:
    `files.metadata.read,files.content.read`.
  - Save a new File: `files.create`; a new version of one (`replace=True`): `files.update`.
  - Tables: `tables.create`, `tables.rows.write`, `tables.schema.update`; also `files.copy`,
    `files.move`, `files.delete`, `tables.copy`, `tables.move`, `tables.delete`.
- What Agent Access asks about makes the run wait as `needs_approval`, with no charge. Its
  receipt has `approvalUrl`, where the person approves it in the Teler app, and a `hint`. Send
  them the link and say what the run will change. Never approve for them, and never change their
  Agent Access to get around it.
- `--wait` keeps waiting while they decide (up to 15 more minutes without `--timeout`); then the
  run starts. Denied or expired, it ends `cancelled`: ask before you submit it again.
- `CAPABILITY_DENIED` means Agent Access does not allow it: tell the person.
  `CAPABILITY_REQUIRED` names what to add to the list.

Ask for this only when the code changes something; a run that only reads needs no
`--capabilities`.

## Receipts

`--wait --json` prints an accepted receipt, then a final one with `status`, `output`,
`chargedCredits` and `artifacts`. Keep the run ID:

```sh
teler run get <run-id> --json      # read it again, any time
teler run wait <run-id> --json     # wait for the end; never resubmits
teler run cancel <run-id> --json
```

A `reconciling` run is still being settled and can still hold credits.

## Failures

- A failed run has `errorCode`. For `execution_failed` (the code raised), `errorDetail` holds the
  traceback. Fix the code and submit it with a new idempotency key: the old key returns the
  failed run. A save or change refused there means the run needs
  [`--capabilities`](#changes-that-need-approval); the `hint` names what it left out.
- A receipt with a `limit` object (`kind` `memory_limit`, `time_limit` or `gpu_needed`) means
  the run needs more than the sandbox gives. Tell the person, and pass on the receipt's `hint`.
- Reached your own `--execution-timeout`? Raise it, or make the code faster.

## Save tested code as a code File

A code File is a Python script that runs in Teler with only its declared inputs and saves named
outputs. It is how tested code goes into production. It uses `teler.job`, not `get_connection`:

```python
import json
import teler.job

params = teler.job.context()["parameters"]
rows = json.loads(teler.job.load_input_bytes("sales"))  # a table input is JSON rows
teler.job.save_json("result", {"total": sum(row["amount"] for row in rows)})
```

A model File input arrives as joblib bytes (`load_input_bytes("model")`). With several outputs,
one must be named `result`.

```sh
teler files save-code job.py --to /personal/jobs/job.py --project <project-id> \
  --input sales=<table-ref> --input model=file:<file-id> --json
teler files run <file-id> --project <project-id> --input sales=<table-ref> \
  --output result --params '{"horizon":4}' --max-credits 2 --idempotency-key <key> --wait --json
teler files result <run-id> --json
teler files output <run-id> result --json         # --output <file> saves it, a model's bytes too
teler files runs --json
```

- Test the logic with `teler run python` first: a code File's failed run shows no traceback.
- `files run` refuses a repeated key (`RETRY_CONFLICT`) instead of running twice; a lost answer
  can hide a run that is already going, so check `files runs` before a new key.
- `files save-code <local.py> --file <file-id>` saves a new version of the same File.
- Code that calls `teler.job.alert(title, figure=None, findings=None)` alerts by a rule, one line
  such as "weekly sales fall below 100 units". With `--output`, pass `--alert-rule "<rule>"`;
  the CLI refuses to drop the rule your last run had (`ALERT_RULE_REQUIRED`).
- A model saved with `teler.models.save` in `run python` becomes a model File; where Agent
  Access asks first, the run needs [`--capabilities`](#changes-that-need-approval) and the
  person's approval.

To run it on a schedule, see [File schedules](file-schedules.md).
