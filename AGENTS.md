# AGENTS.md

Guidance for anyone, human or agent, changing this repository. Also read the
`AGENTS.md` of each package you touch: [`cli/`](cli/AGENTS.md) and
[`desktop/`](desktop/AGENTS.md).

## Boundaries

- These are clients of Teler's public HTTP API. Use only documented endpoints
  and responses; never depend on how the server is built.
- Each package builds on its own. Dependencies come from the npm registry; the
  only workspace dependency is Desktop's `@teler-ai/cli`, which it compiles into
  its sync sidecar. `test/package-boundary.test.ts` in each package enforces
  this.
- Never log or print access tokens, cookies, device codes or other credentials,
  and keep them out of errors and test snapshots.
- Keep secrets, private hostnames and personal data out of code, tests, docs and
  commit messages. Tests use example origins such as `https://app.teler.example`.

## Public repository

Everything here is public: code, tests, docs, commit messages, branch names, pull
request titles and descriptions, review comments and release notes. Write all of
it for an outside reader and describe behavior through the public API. Keep these
out of all of it: internal hostnames, environments and tools; links to private
repositories and their issue or pull request numbers; people's names, email
addresses and other contact details; which AI models, providers or accounts run
the Teler service; customer, organization or account details; and pricing,
business plans or roadmap. Standard AI-assistant attribution lines are fine. When
a change needs a server update, say so in general terms ("needs a server that
returns X; older servers keep working").
Commit with a GitHub noreply address (`<id>+<login>@users.noreply.github.com`)
as both author and committer; CI rejects any other address.

## Conventions

- Strict TypeScript; no `any`. Validate API responses with Zod before using them.
- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Fix bugs test-first, and keep each change focused.
- Before a pull request: `bun run format:check`, `bun run lint`,
  `bun run typecheck` and `bun run test`.
