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

## Conventions

- Strict TypeScript; no `any`. Validate API responses with Zod before using them.
- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Fix bugs test-first, and keep each change focused.
- Before a pull request: `bun run format:check`, `bun run lint`,
  `bun run typecheck` and `bun run test`.
