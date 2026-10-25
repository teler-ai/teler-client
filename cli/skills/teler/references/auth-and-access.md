# Auth and access

## Sign in

```sh
teler auth status --json   # who is signed in, on which origin
teler auth login           # the person approves a code in a browser
teler auth logout
```

- Ask the person to run `teler auth login` themselves; never handle their password or token.
- On Linux without a system keyring (no `secret-tool`):
  `TELER_CREDENTIAL_STORE=file teler auth login` keeps the sign-in in a private file.
- In CI or another headless setup, the person can provide `TELER_TOKEN` instead.
- Never print, log, store or pass on a token.

## Origins and organizations

- `TELER_URL` selects the Teler origin; the default is `https://app.teler.ai`.
- A person can belong to several organizations. Commands use the active one; `--org <org-id>`
  selects another for that command.
- `teler project list --org <org-id> --json` lists the projects visible there.

## Agent Access

Agent Access is the person's policy for what agents may do in Teler on their behalf without
asking, such as changing tables or files.

```sh
teler agent-access show --json               # its preset, or custom
teler agent-access set --preset ask --json   # or standard, read-only, allow-everything --yes
```

Read it when an action is refused for approval. Change it only when the person asks, to the
preset they name; `allow-everything` lets agents act without asking, so confirm it with them.

## Approvals that reach you

A refusal whose code ends in `APPROVAL_REQUIRED` needs a person's approval in the Teler app,
or `--approve <capability,...>` where the command offers it. Ask the person; do not approve on
their behalf without their say.

## Updates

```sh
teler --version
teler update --check --json
teler update               # downloads, verifies and installs the newest stable release
```

A server that no longer supports this CLI version refuses with `CLIENT_UPDATE_REQUIRED`: run
`teler update`, then retry.
