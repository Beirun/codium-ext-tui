# CLAUDE.md

See [AGENTS.md](AGENTS.md) for the canonical project guidance.

Quick reference:

```sh
npm run dev            # TUI (args: npm run dev -- --list)
npm test               # node:test; needs bsdtar on PATH
npm run typecheck      # tsc --noEmit
```

- TypeScript runs directly on Node (type stripping); there is no build step.
- `@opentui/core` needs `--experimental-ffi`; the npm scripts and `bin/codium-ext.js` already pass it.
- Keep platform selection dynamic (`runtimePlatform()` in `src/models.ts`) and spawn `codium` through
  `spawnCommand()` in `src/installed.ts`.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:` …) and push unless
  told not to; no AI co-author trailers.
