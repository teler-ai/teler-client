# Outputs: charts, tables, dashboards and posts

## Charts, tables and other results

What runs and Teler's analyst make (charts, tables, models and data files) is listed by
`chat artifacts` and read with the `artifact` commands.

```sh
teler chat artifacts <chat-id> --json                 # IDs and slugs
teler artifact get <artifact-id> --chat <chat-id> --slug <slug> --json
teler artifact get <artifact-id> --chat <chat-id> --slug <slug> --download --output chart.json --json
teler artifact source <artifact-id> --json            # what produced it, and when
```

To chart numbers you already have, import a static `bar`, `line`, `table` or `metric` chart (a
run, so it costs credits):

```sh
teler artifact create --file chart.json --project <project-id> --max-credits 1 \
  --idempotency-key <key> --wait --json
```

`chart.json`, for example: `{"type":"bar","title":"Revenue","x":"month","y":"revenue","data":[{"month":"Jan","revenue":120}]}`.
`teler schema artifact.create --json` gives every field.

## Dashboards

```sh
teler dashboard create --name "Weekly sales" --json
teler dashboard add-widget <dashboard-id> --artifact <artifact-id> \
  --position '{"x":0,"y":0,"w":2,"h":2}' --idempotency-key <key> --json
teler dashboard list --json                           # page with --cursor <nextCursor>
teler dashboard get <dashboard-id> --json
teler dashboard refresh <dashboard-id> --json         # refresh now
teler dashboard archive <dashboard-id> --yes --json
```

- The grid has four columns: `x` 0–3, `w` 1–4, `x + w` at most 4.
- A chart can follow a scheduled code File instead: `teler dashboard add-widget <dashboard-id>
--schedule <schedule-id> --slot result --chart line --x date --y yhat [--color category] --json`.
  Each successful run of the schedule, or Run now, redraws it at no cost; test runs never do. Only
  the schedule's owner can add it, to a dashboard in the schedule's project, and the File needs one
  successful run first. Charts: `line`, `bar`, `scatter`, `pie` (`--x` names, `--y` values),
  `table`, `number` (`--y` picks the value). `get` shows the widget's `follow` state.
- To change what a dashboard shows (new or reworked charts, filters, analyses), ask Teler's
  analyst with `teler send`, naming the dashboard. The commands here create a dashboard, pin
  charts you already have, set its refresh and share it.
- New dashboards refresh only when asked. Refreshes cost credits, so agree a schedule with the
  person, then `teler dashboard update <dashboard-id> --refresh-interval <setting> --json`:
  `manual`, `on_change` (only after its data changes), or `15m`, `30m`, `1h`, `4h`, `5h`, `1d`.
  The plan sets the shortest interval; a refusal's `hint` names the settings it allows.
- A scheduled refresh can need approval for what it does (for example reading the web):
  `teler dashboard approve-refresh <dashboard-id> --approve <capability,...> --json`.
- `get` shows each widget's `refreshState`. `status: "error"` with `pausedReason: "no_credits"`
  means refreshes wait for credits; `lastRefreshedAt` alone does not prove a refresh succeeded.
- Templates: `dashboard templates`, then `dashboard from-template --file template.json`
  (`{"templateId":"<id>"}`), then poll `dashboard template-progress --chat <chat-id>` and pin
  each finished chart with `add-widget`. Nothing is pinned for you.

## Sharing

Share only when the person asks.

```sh
teler dashboard visibility <dashboard-id> --file visibility.json --json   # {"visibility":"organization"}
teler dashboard share <dashboard-id> --file share.json --json             # {"email":"<email>","permission":"view"}
teler dashboard shares <dashboard-id> --json
teler dashboard unshare <dashboard-id> <share-id> --yes --json
```

Public links (`dashboard public-links|create-public-link|revoke-public-link`) put data on the
open web: never create one unless the person asks for exactly that. Some organizations turn
them off; the refusal says so.

## Posts

A post is a written report with its charts, shared in the organization's feed.

- Easiest: ask Teler's analyst in the chat that has the results, for example
  `teler send --chat <chat-id> --wait --json "Write a post about this analysis."`, or turn a
  dashboard into a post with `teler dashboard create-post <dashboard-id> --json`.
- Your own text: `teler post create --file post.json --json` with
  `{"chatId":"<chat-id>","title":"…","content":"<Markdown>","artifactIds":["<artifact-id>"]}`.
- Read them with `post list|get` and `post comments <post-id>`; `post delete <post-id> --yes`
  deletes one.
