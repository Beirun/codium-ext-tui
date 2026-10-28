# AGENTS.md

Guidance for coding agents working in this repository.

## Project

`codium-ext` is a terminal UI and CLI for searching the Microsoft Marketplace and installing
extensions into VSCodium. It is written in TypeScript, runs directly on Node's type stripping
(no build step), and renders with `@opentui/core`.

## Commands

```sh
npm install
npm run dev                 # TUI; extra args: npm run dev -- --list
npm test                    # node --experimental-ffi --test tests/*.test.ts
npm run typecheck           # tsc --noEmit
```

`bin/codium-ext.js` is the CLI entry point; `npm link` (or a symlink into `~/.local/bin`) exposes it
as `codium-ext`. It re-execs `src/main.ts` with `--experimental-ffi`, which OpenTUI needs.

`npm test` requires `bsdtar` on PATH because `tests/installer.test.ts` builds VSIX fixtures with it.
Tests also load the OpenTUI native core, so they print an ExperimentalWarning under Node.

## Architecture

```
bin/codium-ext.js   CLI shim; passes --experimental-ffi and forwards argv
src/main.ts         arg parsing, TUI bootstrap, headless modes (--list, --probe, --install)
src/models.ts       pure types and logic: version ordering, platform selection, list parsing
src/marketplace.ts  extensionquery search/versions, streamed download with sha256 check
src/installed.ts    codium subprocess helpers, --list-extensions, extensions.json metadata
src/installer.ts    install pipeline: download → validate VSIX → codium install → verify
src/log.ts          per-platform cache root (work dirs, app.log)
src/ui/             App shell (header/body/footer, screen stack) and the screens
tests/              node:test suites
```

Keep `models.ts` free of I/O — it is the unit-tested core. The install pipeline is serialized by a
lock inside `CodiumInstaller`, and cancellation is cooperative through a shared `{ cancelled }` object.

## Conventions

- TypeScript style: no semicolons, double quotes, two-space indent, `import … from "./x.ts"` with the
  explicit `.ts` extension. `strict` and `noUncheckedIndexedAccess` are on; `noEmit` — never add a
  build step.
- Write no comments unless a non-obvious constraint needs explaining.
- Keep platform handling dynamic: use `runtimePlatform()` from `models.ts` rather than hardcoding
  `linux-x64`. Commands that may be `.cmd` shims on Windows must go through `spawnCommand()` in
  `installed.ts`.
- VSIX validation shells out to `bsdtar`, `tar`, or `unzip`; keep a fallback chain so all three OSes work.
- Tests: add cases to the matching suite; pass an explicit `platform` to `selectCompatible` so tests
  stay host-independent.
- Update `README.md` when user-facing behavior, commands, or paths change.

## Git

- Commit and push finished work automatically to `origin main` unless told otherwise.
- Use Conventional Commits: `type(scope): summary`, imperative and lowercase, no trailing period.
  Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, `style`.
  Examples: `feat(installer): verify installs before reporting success`,
  `docs: add AGENTS.md and CLAUDE.md`, `chore: replace run scripts with npm run dev`.
- Never add AI co-author or attribution trailers to commits or PRs.
- Do not rewrite published history or force-push without explicit permission.
