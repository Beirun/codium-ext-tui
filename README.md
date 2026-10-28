# codium-ext

A terminal UI for searching the Microsoft Marketplace and installing extensions into VSCodium.

Built with [`@opentui/core`](https://opentui.com) (Zig core + TypeScript bindings) on Node 26.
Each install follows one pipeline: **download the `.vsix` → `codium --install-extension <file>` → delete the `.vsix`**.

## Requirements

- Node.js **26.4+** (OpenTUI loads its native core through FFI, so the launcher passes `--experimental-ffi`)
- `codium` on `PATH`
- `bsdtar` or `unzip` for VSIX validation

## Run

```sh
npm install
./bin/codium-ext
```

`bin/codium-ext` is a plain script, so it can be symlinked into `~/.local/bin`:

```sh
ln -sf ~/Projects/codium-ext-tui/bin/codium-ext ~/.local/bin/codium-ext
```

## Keys

| Key | Action |
| --- | --- |
| `/` | focus the search box |
| `enter` | search · open the selected extension · run the selected action |
| `↑` | tabs → search bar · search bar → tabs · list → search bar (only at the top; above that it scrolls) |
| `↓` | tabs → search bar · search bar → list |
| `←` `→` | switch tab while the tab strip is focused; the list follows the selected tab |
| `esc` | leave the search box · go back one screen · cancel an install |
| `ctrl+r` | refresh the installed list |
| `q` | quit (not while typing in the search box) |

## Screens

- **Search** — type a query and press enter. Each result is a three-line row: extension display name,
  author display name, then latest version · install count.
- **Installed** — the extensions installed on this machine, read from `codium --list-extensions --show-versions`
  and enriched from `~/.vscode-oss/extensions/extensions.json` (source, pinned, install date). Rows use the same
  shape: display name (from the extension's `package.json`), publisher, then version · source · date.
- **Details** — description, install count, last update, installed version, then
  `Install latest`, `Choose version…`, and — when the extension is installed — `Uninstall` (confirmed first,
  then `codium --uninstall-extension` and a poll until it disappears from the list).
  Version lists are filtered to `universal` / `linux-x64` builds, newest first, with prereleases tagged.
- **Install** — live phase, progress bar and the piped `codium` output. `esc` cancels cooperatively.

## CLI

```sh
codium-ext --list
codium-ext --probe dbaeumer.vscode-eslint
codium-ext --install dbaeumer.vscode-eslint            # latest stable
codium-ext --install dbaeumer.vscode-eslint@3.0.24     # exact version
codium-ext --install <id> --dry-run                    # resolve only
codium-ext --list --extensions-dir /tmp/ext --user-data-dir /tmp/data
```

## Layout

```
src/
  main.ts          CLI entry and headless modes
  models.ts        pure data types: version ordering, platform selection, list parsing
  marketplace.ts   extensionquery search/versions and streamed download with sha256 check
  installed.ts     codium --list-extensions + extensions.json metadata
  installer.ts     work dir, VSIX validation, codium subprocess, post-install verification
  theme.ts         Tokyo Night palette, square borders
  ui/              app shell (header/body/footer, screen stack) and the four screens
tests/             node:test — models, marketplace parsing, installer pipeline, UI via createTestRenderer
legacy/            the earlier Textual (Python) implementation, kept for reference
```

Downloads and installs happen under `~/.cache/codium-ext-tui/work/<uuid>/`, which is removed in a `finally` block;
stale directories older than an hour are swept at startup. A log is written to `~/.cache/codium-ext-tui/app.log`.

## Tests

```sh
npm test          # node --experimental-ffi --test tests/*.test.ts
npm run typecheck # tsc --noEmit
```

## Marketplace notes

- `POST /_apis/public/gallery/extensionquery`, no cookies required.
- `flags: 2423` is required; smaller values (e.g. the browser's `870`) return a single version per extension.
- A search response carries only one version entry per extension, so version lists are always re-fetched by exact id.
- The gallery returns one entry per target platform. Only `universal` and `linux-x64` are kept, preferring `linux-x64`.
- `?targetPlatform=` is appended to the download URL **only** for platform-specific builds; adding it to a universal
  build returns 404.
