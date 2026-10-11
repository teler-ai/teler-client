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
- Never log or display tokens, cookies, URLs with query values or server error
  text. `TelerAPIError` carries none of them.
- Keep private hostnames out of code and docs; scripts read the build Mac from
  `TELER_MAC_HOST`.

## Commands

- Test TelerKit, anywhere: `swift test --package-path ios/Packages/TelerKit`
- Build the app on a Mac with Xcode and XcodeGen: `ios/scripts/build.sh`
  (`--run` also launches it in a simulator and saves a screenshot).
- Build on a Mac from another machine: `TELER_MAC_HOST=user@host ios/scripts/remote-build.sh --run`
- Live transport smoke test: set `TELERKIT_SMOKE_ORIGIN` to a loopback server
  that serves a chat task stream, then run `swift test`.
