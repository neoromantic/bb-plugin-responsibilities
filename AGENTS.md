# bb-plugin-responsibilities

<!-- devkit:agents v1 -->
<!-- managed by devkit v1: edit in https://github.com/neoromantic/devkit/blob/main/agents/AGENTS.shared.md -->

## Shared rules (devkit)

These rules apply to people and coding agents in every repo that uses
[devkit](https://github.com/neoromantic/devkit). Project rules follow in `## Project` below.
Where they conflict, the project section wins.

### Data

- Use only made-up data in tests, fixtures, examples, docs and screenshots. No real people, chats,
  phone numbers, tokens, session files or local paths such as home directories.
- Never commit `.env` files or credentials. Tests run offline by default; live API tests are
  opt-in and read their credentials from the environment.

### Commands

Use the project section's native commands for checks, offline tests and builds:

- Bun: `bun run <script>` (`check`, or `lint` and `typecheck`; `test`, `test:e2e`, `build`).
  `bun run format` formats; `check` fails on unformatted code and on lint errors.
- Python: the documented `uv run` / `uvx` commands, such as pytest, unittest and ruff.
- Go: the documented `go` commands from `go.mod`. Do not add Bun wrappers for Python or Go.
- Use Bun, uv or Go modules for installs. Use npm only for `npm publish` and `npm view`.

### Definition of done

- The change works end to end and the project's applicable checks and tests pass locally.
- README, docs and affected demos change with the behaviour they describe; follow the
  [product content standard](https://github.com/neoromantic/devkit/blob/main/docs/standards/product-content.md).
- No new warnings, no commented-out code, no stray debug output.
- JS and TS follow the [lint and format standard](https://github.com/neoromantic/devkit/blob/main/docs/standards/lint-format.md):
  no prose comments (rationale goes in the PR), tests beside their code, no mocks of the code
  under test, no fixed sleeps or retries. Fix the code; exceptions go in `.oxlintrc.json`.

### Commits and releases

- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`.
  A breaking change adds `!` (`feat!:`) and a `BREAKING CHANGE:` footer.
- One logical change per commit. Never rewrite published history or force-push `main`.
- Follow the project's documented release procedure, including any owner-only steps. It defines
  versioning, tags, changelog and delivery (release, skill revision or production deployment).

### Files

- Don't add planning or progress files (`progress.md`, `docs/plans/`). Plans live in issues.
  `ROADMAP.md`, if present, is a short "Known gaps" list that links issues.
- Don't add agent hooks that rewrite tracked files.
- `AGENTS.md` is the canonical instruction file. `CLAUDE.md` contains only `@AGENTS.md`.
- Files marked "managed by devkit" (this block, `SECURITY.md`, `CONTRIBUTING.md`, the PR
  template, `.gitleaks.toml`, `.github/zizmor.yml`, `renovate.json`, `lefthook.yml`, the
  CI stub, `.oxfmtrc.jsonc` and `.oxlintrc.devkit.jsonc`) are synced from devkit. Change them
  there, not here.

<!-- /devkit:agents -->

## Project

Responsibilities is a full-trust BB plugin (stable ID `responsibilities`). It marks the threads
that need the user (failed, waiting for an answer, unread result), filters the sidebar, highlights
manager threads from a JSON file, adds **New child thread** and an optional compact warm theme.

### Layout

- `package.json` `"bb"` declares the two entries: `server.ts` (attention and seen records in the
  plugin's SQLite database, the managers file watch, the `list`/`seen` RPC from `contract.ts`,
  the import from older attention data in `migrate.ts`) and `app.tsx` (overlays, the sidebar
  footer filter, the row-status content script, New child thread from `child.tsx`, `theme.ts`).
- Tests sit beside the code as `*.test.ts`. React comes from BB at runtime, so only
  `@types/react` is listed; tests load the React that the SDK's dependencies install.
- The plugin relies on experimental BB APIs and internal sidebar attributes; check them against
  the pinned BB when it changes.

### Commands

Bun 1.4.3 and Node 24, as in the README; the landmines lint rules need Node 22.18 or later.

- `bun install --frozen-lockfile`
- `bun run check`: oxfmt check, oxlint with landmines, `tsc --noEmit`, Knip.
- `bun run test`: `bun test`, offline.
- `bun run build`: `bb plugin build` from the pinned `bb-app`, writes `dist/` (gitignored).
- `bun run format`: oxfmt.

### Gotchas

- `esbuild`, `tailwindcss`, `@tailwindcss/node` and `@tailwindcss/oxide` are not imported, but
  `bb plugin build` uses them from `node_modules` when their versions match the ones pinned in
  `bb-app`. Otherwise it downloads its own copies and `app.css` changes. When `bb-app` moves,
  set them to the versions the build lists while downloading. Knip's `ignoreDependencies`
  names them for this reason.
- The npm `files` allowlist ships `dist/` bundles; build before `bun pm pack`.

### Commits and releases

Commit subjects here are short imperative sentences, not Conventional Commits.

1. On a `release/X.Y.Z` branch, commit `Release Responsibilities X.Y.Z`: `version` in
   `package.json` and the pinned `@vX.Y.Z` install refs in `README.md` and `PLUGIN_OVERVIEW.md`.
2. Open a pull request and merge it with a merge commit once `ci` passes.
3. Maintainer only: tag the merge commit `vX.Y.Z` and publish the GitHub release
   `Responsibilities X.Y.Z` with short notes and three assets: `bb-plugin-responsibilities-X.Y.Z.tgz`
   (`bun pm pack` after a frozen-lockfile install and `bun run build`),
   `bb-plugin-responsibilities-X.Y.Z-source.bundle` (`git bundle` of the release commit) and
   `SHA256SUMS`.
