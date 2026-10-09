# Teler clients

The `teler` command-line interface and Teler Desktop, the official clients for
[teler.ai](https://teler.ai). Both work with your Teler account through Teler's
public HTTP API; neither contains any of Teler's server code.

| Directory              | What it is                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`cli/`](cli/)         | `@teler-ai/cli`: chats, dashboards, schedules, data analysis, files and one-way folder sync from a terminal or an agent.        |
| [`desktop/`](desktop/) | Teler Desktop: the Teler web app in a native window, with background folder sync and notifications. Its sync engine is the CLI. |

## Install

Download the CLI or Teler Desktop from this repository's
[releases](https://github.com/teler-ai/teler-client/releases): `cli-v…` releases
have standalone `teler` executables and `desktop-v…` releases have the Teler
Desktop installers. Both check for new releases: `teler update` installs a new
CLI, and Teler Desktop's **Check for Updates…** downloads the new installer.

## Getting started

To work on the clients you need [Bun](https://bun.sh) 1.3.12 or later.

```sh
bun install
bun cli/src/index.ts --help             # run the CLI from the checkout
bun run --filter desktop start          # build and open Teler Desktop
```

Both clients talk to `https://app.teler.ai` unless `TELER_URL` selects another
Teler origin. See the [CLI](cli/README.md) and [Desktop](desktop/README.md)
guides for details.

## Checks

```sh
bun run format:check
bun run lint
bun run typecheck
bun run test
```

## Contributing and security

Bug reports, questions and feature requests are welcome as
[issues](https://github.com/teler-ai/teler-client/issues). Pull requests are
accepted only from the teler-ai organization and this repository's
collaborators; see [CONTRIBUTING.md](CONTRIBUTING.md). Please report vulnerabilities privately as
described in [SECURITY.md](SECURITY.md).

## License

Licensed under the [Apache License, Version 2.0](LICENSE). Third-party notices
are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The license does not
grant rights to the Teler name or logo; see [TRADEMARKS.md](TRADEMARKS.md).
