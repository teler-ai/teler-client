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

- Agent Access: `teler agent-access show` and
  `teler agent-access set --preset ask`, each with optional `--org <id>`.
  `show` emits policy metadata; `set` changes only the authenticated member's
  preset through the normal revision-checked API and preserves chat overrides.
- Files: `teler files list|read|search|write|mkdir|move|copy`
- Uploads: `teler upload <file>`, `teler upload list`, `teler upload status <job-id>`
- Library entry (`@teler-ai/cli`): the API client, device sign-in, credential
  store, sending chat messages, watching tasks and uploads, for programs that drive Teler like the CLI does. The
  command itself is the `@teler-ai/cli/cli` entry.
- Run from a checkout: `bun src/index.ts <command>` in this directory.
- Updates: `teler update [--check]` installs only stable releases of this
  repository after verifying `SHA256SUMS.txt`; the daily startup check stays off
  for `--json`, CI, Teler Desktop's sidecar and `TELER_NO_UPDATE_CHECK`.
- Release executables: `bun scripts/compile.ts [target...]`; published by
  `.github/workflows/cli-release.yml` (manual, `main` only).
- Typecheck: `bun run --filter @teler-ai/cli typecheck`
- Test: `bun run --filter @teler-ai/cli test`
