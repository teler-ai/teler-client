# Teler Desktop

Teler Desktop is the Teler web app in a native window, plus background folder
sync: choose folders on your computer and they stay uploaded to Teler. A tray
icon shows the sync state and keeps sync running after the window closes.

## How it works

- **Window.** The main window loads the hosted Teler origin
  (`https://app.teler.ai`, or `TELER_URL`). Everything except sync behaves as in
  the browser. Remote pages run sandboxed with no preload or Node access, and
  the window stays on the Teler origin (and, for an origin protected by
  Cloudflare Access, its sign-in pages). Same-origin popups, such as connector
  sign-in or the upload upgrade page, open in app windows and may continue to
  their HTTPS provider there. Other sites open in the default browser,
  including payment pages.
- **Top bar.** The native title bar is hidden. A bundled page
  (`teler-desktop://app/title-bar.html`) above the Teler page shows the Teler
  mark, back, forward and reload and the sync status (opens Synced folders);
  on Windows and Linux also the application menu. The window
  controls stay native: inset traffic lights on macOS, themed overlay buttons on
  Windows and Linux (`src/main/main-frame.ts`).
- **Sign-in.** Users sign in inside the window with the normal Teler sign-in.
  Magic-link emails open in the default browser, so **File → Sign in with copied
  link** accepts a copied link for the configured origin.
- **Sync.** The `teler` CLI is compiled with `bun build --compile` and bundled
  as a sidecar. The app supervises `teler sync daemon` and restarts it with
  backoff if it exits. Quitting stops it. The app manages folders only through
  the CLI's `--json` commands. Sync state lives in the app's data directory,
  separate from any CLI install.
- **Authorization.** **Connect folder sync** takes one click. The app requests
  a CLI device code, then claims and approves it itself with the window's Teler
  session (as the `/device` page would), for
  every organization of the signed-in account (`src/main/window-session.ts`).
  The device grant then issues a separate, organization-scoped sync token,
  encrypted with the OS keyring through Electron `safeStorage` and given only
  to the sidecar. Without a keyring (some Linux setups) it is kept in memory
  until Teler quits.
- **Sync follows the session.** Signing out of the window revokes the sync
  token and stops sync; folders are kept. Signing back in reconnects it, and
  another account signing in takes it over. **Disconnect** keeps sync off,
  across sign-ins, until the user connects again (`src/main/sync-session.ts`).
- **Desktop actions in the web app.** The window's user agent is Chromium's
  with `TelerDesktop/<version>` instead of Electron's tokens. The web app then
  offers **Sync a folder** (a dismissible banner on the home page, and in a
  project's **Add data** menu), which navigates to
  `teler-desktop://sync-folder?organizationId=…&projectId=…&projectName=…`. The
  main window intercepts it, from Teler pages only, and opens Synced folders
  with the folder picker; the folder syncs into that organization and project.
- **Who can sync.** Folder sync has the same access as the CLI: every
  verified Teler account. If the API still refuses a newly approved token (for
  example for an unverified account), the app says folder sync isn't available
  for the account and ends that token's session.
- **Synced folders.** A bundled React page at `teler-desktop://app/`, shown
  in the main window in place of the Teler page (the top bar's sync status,
  the tray or **Synced folders…** open it; **Back to Teler** or Escape returns).
  It lists folders with their organization, project and status, adds folders
  with a preview of what will upload (choosing the organization when the account
  has several), and pauses, resumes or removes them. Removing a folder never
  deletes files from Teler.
- **Waiting files.** A temporary failure is not a problem to fix: the file
  waits and retries automatically, and the page says why and when, with
  **Retry now**. When Teler rate-limits uploads, nothing starts until the server
  allows it again (a large folder uploads in steps), and the page says when.
- **Notifications.** Desktop notifications for files ready in Teler (new or
  updated), a folder's first full sync, files that need attention and a chat
  whose turn finished, and an Agent alert that opens or goes back to normal
  (`src/main/notifications/`). Each kind is grouped: one
  notification once that kind has been quiet for a few seconds (at most a
  minute), replacing the previous one; waiting (retrying) files never notify.
  Nothing shows or plays while a Teler window is in front. Notifications use
  the OS sound, so Do Not Disturb applies; on macOS each kind has its own
  system sound. A click opens the source (the file, the data page, the chat, the alert or
  Synced folders), switching Teler to its organization first. Chats are
  watched from the main process with the window session: every few seconds
  while one runs or after a message is sent from the window, otherwise once a
  minute. Agent alerts come from `GET /api/alerts/feed` (every organization),
  read once a minute from a cursor kept in memory: each start takes a fresh
  baseline, so alerts that already existed are never announced; one
  notification when an alert opens and one when it is back to normal.
  Synced folders has a switch per kind and one for the sound.
- **Tray.** The first line is the sync state and opens Synced folders (or
  connects); the second is the account and the organization open in Teler, and
  opens Teler. Then **Sync a folder…**, pause or resume, open at login and quit.

## Development

```sh
bun install
bun run --filter desktop start   # build, then run Electron against production
bun run --filter desktop test
bun run --filter desktop typecheck
```

`TELER_URL` selects another origin that serves the whole app, as production and
a self-hosted deployment do:

- **Behind Cloudflare Access:** when Access protects the whole hostname and
  signs in with GitHub, its login completes in the window, and sync reuses that
  Access session: the main process sends its token
  as `cf-access-token` and the sync helper gets it as `TELER_ACCESS_TOKEN`
  (`src/main/access-token.ts`). When Access asks you to sign in again, sync
  restarts with the renewed token; if sync stops while the window is closed,
  open it to sign in to Access again. Other identity providers open in the
  default browser, so with them sync may not connect.
- **Separate sign-in origin:** `TELER_AUTH_URL` is a development-only override
  for an origin whose sign-in pages and account API are served from a second
  origin (it adds a trusted origin):

  ```sh
  TELER_URL=http://localhost:3000 TELER_AUTH_URL=http://localhost:3001 \
    bun run --filter desktop start
  ```

`start` (`scripts/start.ts`) runs the `@teler-ai/cli` package with Bun as the
sync sidecar. On macOS it runs a cached copy of Electron.app named Teler, with
Teler's icon, re-signed ad hoc (`scripts/dev-mac-app.ts`), so the menu bar, Dock
and notifications say Teler; it falls back to the stock app if that fails.
Opening at login needs the installed app. Set `TELER_DESKTOP_SIDECAR=/path/to/teler` to try a compiled sidecar
instead. Electron downloads its binary the first time it runs.

## Packaging

```sh
bun run --filter desktop dist   # bundles, compiles the sidecar and packages for this machine
```

`scripts/sidecar.ts` accepts targets (`mac-arm64`, `mac-x64`, `linux-x64`,
`linux-arm64`, `win-x64`). macOS installers must be built on macOS. Outputs are
written to `desktop/release/`. Before packaging, `scripts/smoke-sidecar.ts`
runs this machine's compiled sidecar without a server: it previews a folder and
starts and stops the sync daemon. `scripts/verify-package.ts` then fails the
build if a packaged app contains anything besides `dist/` and the sidecar (for
example a workspace's `node_modules`).

## Releases

Run **Publish Teler Desktop release** (`.github/workflows/desktop-release.yml`)
from `main`:

- `nightly` publishes `desktop-v<version>-nightly.<run>` as a prerelease.
- `stable` requires the version input to equal `package.json`'s `version` and
  publishes `desktop-v<version>`. Bump the version in a PR first.

The workflow builds on GitHub-hosted runners: macOS (arm64 and x64), Windows
(x64) and Linux (x64). It publishes installers with `SHA256SUMS.txt` and never
overwrites a release.

### Signing

Builds are unsigned unless these optional repository secrets exist:

| Secret                                                                             | Purpose                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `DESKTOP_MAC_CSC_LINK`, `DESKTOP_MAC_CSC_KEY_PASSWORD`                             | Developer ID Application certificate (base64 `.p12`) |
| `DESKTOP_APPLE_ID`, `DESKTOP_APPLE_APP_SPECIFIC_PASSWORD`, `DESKTOP_APPLE_TEAM_ID` | Notarization                                         |
| `DESKTOP_WIN_CSC_LINK`, `DESKTOP_WIN_CSC_KEY_PASSWORD`                             | Windows Authenticode certificate                     |

Unsigned macOS builds are ad-hoc signed so Apple silicon can run them. On the
first launch macOS refuses to open them: choose **Open Anyway** in System
Settings → Privacy & Security, then open Teler again (macOS 15 removed the
Control-click → Open shortcut). If Gatekeeper still blocks the bundled sync
helper (folder sync keeps restarting), clear the quarantine attribute:
`xattr -dr com.apple.quarantine /Applications/Teler.app`. Unsigned Windows
builds show SmartScreen's **More info → Run anyway**.

## Updates

A packaged Teler checks for a newer stable release (tags `desktop-v…`) 30
seconds after it starts and twice a day. A new version shows a notification and
an **Update to Teler …** line in the tray; **Check for Updates…** (in the Teler
menu on macOS, the Help menu elsewhere) checks on demand. Updating downloads the
installer for this computer from the release (the `.dmg` for its Mac, the
Windows `.exe`, or the AppImage or `.deb` the app was installed from) in the
default browser; installing it over the current app keeps synced folders and
settings. The bundled sync helper never checks for CLI releases itself. Set
`TELER_NO_UPDATE_CHECK=1` to turn the automatic checks off.

## Platform notes

- **Linux:** the tray needs an AppIndicator host (on GNOME, the AppIndicator
  extension). Folder sync stays connected across restarts only with a Secret
  Service or KWallet keyring. **Open at login** writes an XDG autostart entry.
- **Open at login:** the first launch of a packaged build asks whether Teler
  should open at login, with yes as the default. A DMG or AppImage has no
  installer step, so every platform asks then. The tray and Synced folders
  change it later.
- Installers are large (≈150–200 MB) because the sidecar embeds the Bun runtime.

## Not included yet

- Installing updates in place (they are downloaded and installed manually).
- A browser-based sign-in handoff.
- Two-way sync and deletion mirroring.
