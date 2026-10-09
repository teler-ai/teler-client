# Contributing

Thank you for helping improve the Teler clients. This repository contains the
`teler` CLI and Teler Desktop. Teler's server is not part of it, so changes here
work with the public API as it is today.

## Issues welcome, pull requests from the team

Anyone can contribute through issues. Pull requests are accepted only from the
teler-ai organization and this repository's collaborators; others are closed
automatically with a pointer back to issues. Members open pull requests from a
branch of this repository, which needs write access through a team or the
organization's base permission; a fork's pull request is kept only when GitHub
shows its author as a member, so a private organization membership is not
enough there. To accept work from someone outside, a maintainer adds them as a
collaborator first.

- For a bug, open an issue with the client and version, your operating system,
  the command or steps, and what happened. Remove tokens, cookies, email
  addresses and file contents first.
- For a feature or a change you would like, open an issue describing it. If it
  needs something the API does not offer, say so in the issue.
- Report security problems privately; see [SECURITY.md](SECURITY.md).

The rest of this guide is for members of the organization.

## Development

You need [Bun](https://bun.sh) 1.3.12 or later.

```sh
bun install
bun run format:check
bun run lint
bun run typecheck
bun run test
```

Read [AGENTS.md](AGENTS.md) and the `AGENTS.md` of the package you change. In
short:

- Keep each pull request to one focused change, with tests. Fix bugs test-first.
- Use conventional commit messages (`feat:`, `fix:`, `docs:` and so on).
- Desktop copy lives in locale catalogs; add every supported language when you
  add or change a string.
- Do not add dependencies on other workspaces or on Teler's server packages.

## Licensing of contributions

This project is licensed under the [Apache License, Version 2.0](LICENSE).
Unless you state otherwise, any contribution you intentionally submit for
inclusion, including text and code in issues, is licensed under the same terms,
as section 5 of the license describes.
