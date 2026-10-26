# @teler-ai/cli — authenticated public CLI

Scope: `cli/`. Also follow the repository root `AGENTS.md`.

## Scope

This package is the publishable, user-authenticated Teler CLI. It communicates
only with the versioned HTTP API selected by `TELER_URL`; production
(`https://app.teler.ai`) is the default.

## Boundaries

- Use only Teler's public HTTP API. Import nothing but builtins, this package's
  declared dependencies and its own files (`test/package-boundary.test.ts`).
- Never accept user IDs, session cookies, database URLs, or internal service
  credentials as authentication substitutes.
- Bind stored credentials to the canonical resource origin that issued them.
- Require HTTPS except for loopback development and reject cross-origin redirects
  on authenticated requests.
- Keep access tokens, refresh tokens, authorization codes, and cookies out of
  stdout, stderr, errors, and test snapshots.
- Human-readable output is the default; `--json` is the stable automation surface.

## Commands

Every command is in `src/command-catalog*.ts`, which `teler schema` prints; its test
fails when the usage text (`src/usage.ts`) and the catalog differ. By area:

- Sign-in and discovery: `auth login|status|logout`, `schema`, `--version`, `update`.
- Coding agents: `agent setup` installs the skill folder `skills/teler/` (bundled
  as text: `SKILL.md` and every guide in `references/`) for Claude Code and Codex,
  offline. Agents read it whenever they use Teler: keep `SKILL.md` lean (core loop,
  safety rules, links to the guides) and each guide short, public and in step with
  the commands. A new guide must be imported in `src/agent-setup.ts`, linked from
  `SKILL.md` and copied to `../plugins/teler/skills/teler/`; the tests check all
  three. Reruns report `unchanged`.
- Data and runs: `project list`, `data list|describe|query`, `run python|get|wait|cancel`,
  `artifact create|get|source`.
- Files: `files list|read|search|write|mkdir|move|copy|delete|restore|trash` (`delete` moves
  one File to the trash with `--yes`, never permanently and never a folder); code Files:
  `files save-code|run|result|runs|output` and
  `schedule file create|show|quote|approve|pause|resume|re-pin|runs|latest|delete`
  (approval takes the revision read, an explicit monthly cap and `--yes`).
- Uploads and sync: `upload <file>`, `upload list|status`, `sync <folder>`,
  `sync list|status|pause|resume|retry|remove|stop|daemon`.
- Chats: `send`, `steer`, `task watch`, `approval respond`,
  `chat list|show|artifacts|seen|delete`.
- Attention: `status`, `watch` (events as NDJSON with `--json`), `chat seen`,
  `agent runs`, `notifications`; all read the public attention and inbox routes.
  `@teler-ai/cli/attention` exports the schema, the reader, the tracker and the watch loop.
- Dashboards and posts: `dashboard …` and `post …` (list, get, create, update,
  delete, move, visibility, sharing, public links, templates, comments, export);
  `src/resource-actions.ts` holds the actions beyond the basic ones. Dashboard
  refresh settings are `manual`, `on_change` or an interval; the server enforces
  plan minimums and explains refusals in a `hint`.
- Teler Agents and schedules: `agent list|get|create|update|delete`, the owner's
  `agent run|spend-cap|allow-and-rerun|apply-skipped` (`src/agent-owner-command.ts`; `run` needs
  `--idempotency-key`, raising a spend cap needs `--yes`),
  `schedule create|approve|list|update|pause|resume|history|delete`. The list reads
  `alert_opened` starts and leaves out a start kind it does not know; `update|pause|resume|approve`
  report one instead of failing. A File that alerts keeps its rule: `--output` needs `--alert-rule`.
- Knowledge: `skill …` and `memory …` (`src/resource-options.ts`).
- Agent Access: `agent-access show` and `agent-access set --preset standard|ask|read-only|allow-everything`
  (the app's presets, `src/agent-access-presets.ts`; `allow-everything` needs `--yes`), each with
  optional `--org <id>`. `show` emits policy metadata; `set` changes only the
  authenticated member's preset through the normal revision-checked API and
  preserves chat overrides.
- Errors: `--json` failures are `{"error":{"code","message",...,"hint"}}`. The CLI's
  own hint for a code, reason or status wins; a refusal's plain-text `hint` fills in
  or replaces the generic plan hint (`src/errors.ts`, `src/api.ts`).
- Library entry (`@teler-ai/cli`): the API client, device sign-in, credential
  store, sending chat messages, watching tasks and uploads, for programs that drive Teler like the CLI does. The
  command itself is the `@teler-ai/cli/cli` entry.
- Run from a checkout: `bun src/index.ts <command>` in this directory.
- Updates: `teler update [--check]` installs only stable releases of this
  repository after verifying `SHA256SUMS.txt`; the daily startup check stays off
  for `--json`, CI, Teler Desktop's sidecar and `TELER_NO_UPDATE_CHECK`.
- Version: a release bumps `version` in `package.json` and in both manifests in
  `../plugins/teler/` (`test/plugin-listing.test.ts` checks they match).
- Release executables: `bun scripts/compile.ts [target...]`; published by
  `.github/workflows/cli-release.yml` (manual, `main` only). On a Mac, macOS
  executables are re-signed (`scripts/mac-signature.ts`): ad hoc locally; in
  releases with Teler's Developer ID (`DESKTOP_MAC_CSC_LINK`), the hardened
  runtime and `build/entitlements.mac.plist`, then notarized with the App Store
  Connect API key (`DESKTOP_APPLE_API_*`). A release without them fails.
- Typecheck: `bun run --filter @teler-ai/cli typecheck`
- Test: `bun run --filter @teler-ai/cli test`
