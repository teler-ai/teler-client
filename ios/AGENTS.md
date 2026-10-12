# AGENTS.md — Teler for iOS

Scope: `ios/`. Also follow the repository root `AGENTS.md`.

## Layout

- `Packages/TelerKit`: the Swift package with everything that is not UI.
  - `TelerKit`: the API client, the event-stream parser, chat models and the
    merge rules for streamed message parts.
  - `TelerDemo`: an offline demo API that previews, tests and the demo mode use.
  - It has no UI framework or third-party dependency, so it builds and tests on
    Linux as well as on a Mac.
- `Teler/`: the SwiftUI app, iOS 26 and later.
  - `Design/`: the colors (`Palette`, named like the web app's design tokens),
    Fraunces for large titles (`Typeface`), Teler's mark and shared components.
    Use these rather than system or literal colors.
  - `App/`: the session, the tabs (Today, Chats, search) and their routes.
- `project.yml`: the XcodeGen spec. `Teler.xcodeproj` is generated and not
  committed.

## Boundaries

- Use only Teler's public HTTP API and the response shapes the CLI and the web
  app rely on. Decode every part a newer server may add without failing: an
  unknown message part becomes `ContentField.unknown`.
- Merge streamed parts with `ContentMerge`, which follows the web app's rules,
  and reload the chat when a turn ends.
- Send `Teler-Client: teler-ios/<version>` on every request. An HTTP 426 means
  this version is no longer supported.
- Sign in through Teler's existing auth endpoints and keep the same cookie
  session as the web app (`CookieJar`), sent with the origin's `Origin` header.
  The session lives only in the Keychain on this device; never log it.
- Never log or display tokens, cookies, URLs with query values or server error
  text. `TelerAPIError` carries none of them.
- Keep private hostnames out of code and docs; scripts read the build Mac from
  `TELER_MAC_HOST`.

## Commands

- Test TelerKit, anywhere: `swift test --package-path ios/Packages/TelerKit`
- Build the app on a Mac with Xcode and XcodeGen: `ios/scripts/build.sh`
  (`--run` also launches it in a simulator and saves a screenshot).
- Build on a Mac from another machine: `TELER_MAC_HOST=user@host ios/scripts/remote-build.sh --run`
- Live transport tests: start `python3 -I ios/scripts/smoke-server.py 48731`, then
  run `TELERKIT_SMOKE_ORIGIN=http://127.0.0.1:48731 swift test --package-path ios/Packages/TelerKit`.
- Debug launch arguments for screenshots: `TELER_DEMO=1` opens the demo and
  `TELER_ROUTE` opens a screen: `tab:home`, `tab:chats`, `tab:dashboards`, `tab:search`, `new`,
  `chat:<id>`, `dashboard:<id>`, `ask:<question>`, `search:<text>`, `needs` or `chart:<chat id>/<slug>`
  (`-TelerChartState pick:<index>|focus:<series>|table` sets how the chart opens). Sign-in and session states
  open without a server: `screen:start`, `screen:wrong-password`,
  `screen:twofactor`, `screen:backup`, `screen:again`, `screen:setup` and
  `screen:update`. Use them with `scripts/build.sh --run` or
  `scripts/remote-build.sh --run`.
- `-TelerDemoDelay <milliseconds>` slows the demo's streamed answers, to
  photograph an answer while Teler works on it.
- Answers render natively from the message parts: the plan and
  `analysis_activity` parts become the steps (`AnswerLayout`), `chart_artifact`
  parts are fetched from `/api/chat/:id/artifact/:slug/data` and drawn with
  Swift Charts, and parts the web hides (reasoning, receipts, raw code) stay
  hidden. Any other part shows a link to the web.
- Teler's questions (`askUser` tool calls, kept for every member by the
  server's activity projection) are answered natively, as on the web
  (`apps/chat/web/src/ask-user/`): the answer turn's text is what the model
  reads (`QuestionAnswers.text`) and `questionAnswers` is its receipt. Live
  questions send Teler's picks after 30 seconds untouched. Permission requests
  (`web_approval`) are decided on the web for now: resuming the run natively
  needs the AI SDK's tool-approval continuation.
- Home's Needs you mirrors the web's (`apps/chat/web/src/home/home-needs.ts`):
  Agent alerts and flags (`GET /api/home/flags?alerts=1`, Seen through
  `POST /api/alerts/:id/seen` and `POST /api/home/flags/:runId/seen`) and
  access requests to answer (`GET /api/access/activity`, items from
  `/api/access/requests/:id/review`, `POST .../decide` with the fixed decline
  reasons). Giving access asks for Face ID or the passcode first.
- Attachments upload like the web's (`apps/chat/web/src/lib/api/file-upload.ts`):
  `POST /api/uploads` into `/personal/chats/<chat>`, 8 MiB parts with
  retries, a heartbeat every 20 s, `complete`, then `GET /api/uploads/:job`
  every 3 s until the documents are ready; the turn sends ready tables as
  `scopedTables`, other files as `scopedFiles`, and `fileReferences` for the
  chips. Files picked for a new chat wait until the first question creates it.
  `-TelerAttach YES` attaches sample files to the chat a route opens.
- Delete account follows the web's account page
  (`apps/auth/web/src/portal/account-deletion-dialog.tsx`): `GET
  /api/account/preflight`, `POST /api/account/prepare` (it sets a recovery
  cookie scoped to `/api/account`, so the cookie jar honors cookie paths),
  `identity-email` for accounts without a password, `confirm` with the
  password or emailed code plus the authenticator code, then `completion`
  until it finishes. The same `Idempotency-Key` runs through one deletion. The
  system alert stands in for typing "DELETE MY ACCOUNT". Debug screens:
  `screen:delete-blocked`, `screen:delete-confirm`, `screen:deleting`, `screen:deleted`.
- Every turn sends the app's `language` and the member's `timeZone`; without
  them the server answers in English and reads dates in UTC.
- Charts follow the web's rules so a chart reads the same on both: series
  colors (`ChartAppearance`, from `packages/ui/src/lib/chart-palettes.ts`),
  when a color column makes series, which older charts aren't drawn
  (`ChartSpec.limitation`, from `chart-capabilities.ts`) and the CSV export
  (`chart-export.ts`). Change them together with the web.
- Dashboards are read-only: `GET /api/dashboard`, `GET /api/dashboard/:id?include=metadata`
  and each widget's `GET /api/dashboard/:id/widget/:wid/data` (the same chart
  format as chat charts). Never call refresh or other dashboard writes from the
  app: refreshes run queries on the organization's credits. Show widget
  refresh failures by their reason code only, never the server's message.
- When the server ends the session (HTTP 401 outside sign-in), the app asks to
  sign in again over the open screens; HTTP 426 blocks it until updated; an
  account without an organization is sent to finish setting up on the web.
