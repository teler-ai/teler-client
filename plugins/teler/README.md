# Teler plugin for Claude Code and Codex

This plugin teaches Claude Code and Codex to work with your organization's data in
[Teler](https://teler.ai) through the `teler` command-line interface. With it, your coding agent
can find your projects and tables, run SQL and Python on them in Teler's sandbox, ask Teler's
analyst agent, pin the resulting charts to dashboards, write posts, and put tested Python on a
schedule.

It contains one skill, `teler`: a short `SKILL.md` with the core loop and safety rules, and a
guide per area in `skills/teler/references/`. It adds no hooks, commands or MCP servers, and it
runs nothing by itself.

## What you need

- A Teler account.
- The `teler` CLI on your `PATH`: download it from this repository's
  [releases](https://github.com/teler-ai/teler-client/releases) (`cli-v…`), then sign in once
  with `teler auth login`. See the [CLI guide](https://github.com/teler-ai/teler-client/tree/main/cli).

## What it runs and sends

The skill tells your agent to run `teler` commands. The CLI talks only to the Teler origin you
choose (`https://app.teler.ai` unless `TELER_URL` says otherwise), signed in as you, and sends
what each command needs: your questions, the SQL or Python you run, files you upload, and the
dashboards, posts and schedules you create. Your sign-in stays in your system keyring or a
private file. Each run spends your organization's Teler credits up to the cap your agent gives it
(`--max-credits`). Dashboard refreshes and scheduled runs spend credits too; the skill asks your
agent to agree any refresh schedule, monthly spend, sharing or deletion with you first.

## Without the plugin

`teler agent setup` installs the same skill into Claude Code's and Codex's skill folders, offline.
Use one or the other: with both, your agent sees the skill twice.

## License

Apache-2.0. The license does not cover the Teler name or logo; see
[TRADEMARKS.md](https://github.com/teler-ai/teler-client/blob/main/TRADEMARKS.md).
