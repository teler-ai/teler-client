# AGENTS.md

Scope: `desktop/` (Teler Desktop). Also follow the repository root `AGENTS.md`.

## What

An Electron app: the hosted Teler web app in a window, plus background folder
sync with a tray icon. Sync is the `teler` CLI (`@teler-ai/cli`) compiled into
a sidecar and supervised by the main process; the app never reimplements sync.

## Boundaries

- Remote Teler pages never get a preload script, Node integration or IPC. Keep
  `contextIsolation`, `sandbox` and the policy in `src/main/navigation-policy.ts`;
  change its tests with any rule change.
- Only the bundled local pages (`teler-desktop://app/`) receive a bridge: the
  Synced folders page (a view of the main window) gets `window.telerDesktop`, the main window's top bar
  (`title-bar.html`) gets the narrower `window.telerTitleBar`
  (`src/main/title-bar-ipc.ts`). IPC handlers check the sender and validate every
  payload (`src/main/ipc.ts`); treat the renderer as untrusted input.
- Drive sync only through the CLI's `--json` commands (`src/main/sync-cli.ts`).
  `test/main/cli-contract.test.ts` pins that contract against the real CLI. Never
  read the sync database directly.
- The sync token is stored only through `safeStorage`
  (`src/main/credential-store.ts`) and reaches only the sidecar's environment.
  Never log it, send it to a renderer or write it in plain text.
- The sidecar environment drops inherited `TELER_*` values and sets
  `TELER_SYNC_DAEMON=managed`; the supervisor owns `teler sync daemon`.
- On an origin behind Cloudflare Access, the window session's Access
  token (`src/main/access-token.ts`) goes only to main-process requests for the
  Teler origin and the sidecar's `TELER_ACCESS_TOKEN`. Treat it like the sync
  token: never log it or send it to a renderer.
- Sync authorization reuses the `teler-cli` device grant; there is no
  desktop-specific auth endpoint. The main process claims and approves its own
  device code with the Teler window's session cookies (`src/main/window-session.ts`, the
  endpoints the `/device` page uses) and keeps only the resulting sync token.
  Window session cookies go only to main-process requests to the auth origin
  and, for notifications, to two reads on the Teler origin: the chat list
  (`GET /api/chat`) and the Agent alert feed (`GET /api/alerts/feed`), both in
  `src/main/notifications/`; never forward them to the sidecar or a renderer.
  Teler decides who can sync (today every verified account); the app shows
  `not-eligible` when it refuses.
- Sync follows the window session (`src/main/sync-session.ts`): signing out
  revokes the sync token, and signing in reconnects only if the user connected
  and has not disconnected since.
- Remote pages ask for desktop actions only by navigating to
  `teler-desktop://sync-folder` (`src/main/sync-target.ts`); the main window
  accepts it only from Teler-origin pages and validates every parameter.
- Copy lives in `src/main/locales` (tray, menus, dialogs) and
  `src/renderer/locales` (Synced folders and the top bar), in every supported language.
- Update checks (`src/main/updates/`) read the official releases through
  `@teler-ai/cli/releases` and only open download URLs of those releases in the
  default browser; the app never downloads or runs an update itself.
- The local pages use their own components (`src/renderer/ui`, built on
  shadcn/ui and Radix) and semantic theme tokens. Their
  CSP forbids remote resources.

## Commands

- Test: `bun run --filter desktop test`
- Typecheck: `bun run --filter desktop typecheck`
- Bundle: `bun run --filter desktop build`
- Run: `TELER_URL=<origin> bun run --filter desktop start` (default: production)
- Package for this machine: `bun run --filter desktop dist` (smoke-tests the
  compiled sidecar first: `scripts/smoke-sidecar.ts`)
- Releases: `.github/workflows/desktop-release.yml` (manual, `main` only); see
  `README.md`.
