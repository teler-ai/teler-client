# Agents and chats

## Ask Teler's analyst

Teler's analyst agent knows the organization's data, writes and runs its own queries and code,
and makes charts, dashboards and posts. Ask it when a question needs exploring rather than one
query you can write yourself.

```sh
teler send --new --wait --json "Which regions grew fastest last quarter?"
teler send --chat <chat-id> --wait --json "Break that down by product."
```

- `--wait --json` streams NDJSON. `task.update` events carry partial text; the `task.result`
  event holds the final answer, which replaces the streamed text (do not append it).
- `--model-set lite|pro` picks a lighter or stronger model set; `--title` names a new chat.
- `teler steer <chat-id> "<guidance>"` adds guidance to a turn that is still running.
- `teler task watch <chat-id> <task-id> --json` follows a turn you started earlier.

## Approvals

A turn can stop to ask permission (state `awaiting_approval`). Ask the person, then answer
with their decision:

```sh
teler approval respond <chat-id> <approval-id> --allow --wait --json   # or --deny
```

## Chats

```sh
teler chat list --json
teler chat show <chat-id> --json
teler chat artifacts <chat-id> --json
teler chat seen <chat-id> --json
teler chat delete <chat-id> --yes --json   # permanent
```

Runs and `send --new` each create a chat. Reuse one with `--chat`, and delete the ones you made
and no longer need.

## What is running

```sh
teler status --json                 # running chats and Agent runs, unseen results, notifications
teler watch --json --timeout 600    # NDJSON: chat.started|finished, agent_run.started|finished, notification
teler notifications --json
teler agent runs --active --json
```

## Teler Agents

A Teler Agent is a saved set of instructions Teler runs on demand or on a schedule.

```sh
teler agent list --json
teler agent get <agent-id> --json
teler agent create --name weekly-sales --label "Weekly sales" --content-file agent.md --json
teler agent update <agent-id> --content-file agent.md --json
teler agent delete <agent-id> --yes --json
```

`create` and `update` also take `--description`, `--model-set lite|pro`,
`--output none|private_post`, `--capabilities <capability,...>` and, for create,
`--scope personal|organization`.

Schedule a ready Agent at a UTC time:

```sh
teler schedule create --agent <agent-id> --frequency weekly --day-of-week 1 --time-utc 09:00 --json
teler schedule list --json
teler schedule history <schedule-id> --json
teler schedule update <schedule-id> --time-utc 10:00 --json
teler schedule pause <schedule-id> --json
teler schedule resume <schedule-id> --json
teler schedule delete <schedule-id> --yes --json
```

`create` and `update` take `--prompt "<text>"` and `--delivery chat|email`. A schedule whose
runs need permissions waits for `teler schedule approve <schedule-id> --approve <capability,...>`.
`schedule list` also shows event starts (a table updating, another Agent finishing, an alert
opening on an Agent or a File); `update`, `pause`, `resume` and `approve` take their IDs.

## Knowledge: skills and memories

Teler's analyst also reads the person's skills (how to do a kind of task) and memories (facts and
preferences). Add one only when the person asks.

```sh
teler skill list --json
teler skill create --name <slug> --label "<label>" --description "<when to use it>" --content-file skill.md --json
teler memory list --json
teler memory create --name <slug> --label "<label>" --description "<what it is>" \
  --content-file memory.md --type preference --json   # or domain, feedback, reference
```

`update` and `delete <id> --yes` work on both.
