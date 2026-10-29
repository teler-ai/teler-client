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
  or `DELETE` on organization tables, and only where the person's Agent Access allows changes
  without asking.
- Charts the code makes come back as results (IDs in the receipt); see [outputs](outputs.md).
- `--execution-timeout <seconds>` (default 60, up to 3600 or the plan's limit) bounds the run.
  `--timeout` bounds only your waiting: the run goes on.
- Runs cost credits, at most `--max-credits`, and need a paid plan; a refusal's `hint` says what
  to do.

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
  failed run.
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
- A model saved with `teler.models` in `run python` becomes a model File only where Agent Access
  allows file changes without asking; otherwise train inside the job from its table inputs.

To run it on a schedule, see [File schedules](file-schedules.md).
