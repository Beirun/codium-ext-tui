# codium-ext

A terminal UI for searching the Microsoft Marketplace and installing extensions into VSCodium.

Built with [`@opentui/core`](https://opentui.com) (Zig core + TypeScript bindings) on Node 26.
Each install follows one pipeline: **download the `.vsix` → `codium --install-extension <file>` → delete the `.vsix`**.

## Requirements

- Node.js **26.4+** (OpenTUI loads its native core through FFI, so the launcher passes `--experimental-ffi`)
- `codium` on `PATH` (`codium.cmd` on Windows)
- `bsdtar` or `unzip` for VSIX validation — Linux has `unzip` or `bsdtar`, macOS ships `bsdtar`, and
  Windows 10+ ships `tar.exe`, which the installer also uses

Supports Linux, macOS, and Windows on x64 and arm64.

## Run

```sh
npm install
./run.sh          # macOS / Linux
run.cmd           # Windows (cmd)
.\run.ps1         # Windows (PowerShell)
```

Each launcher resolves its own location, so `run.sh` can be symlinked into `~/.local/bin`:

```sh
ln -sf ~/Projects/codium-ext-tui/run.sh ~/.local/bin/codium-ext
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
  publisher id, then latest version · install count.
- **Installed** — the extensions installed on this machine, read from `codium --list-extensions --show-versions`
  and enriched from `extensions.json` in the VSCodium extensions directory (`~/.vscode-oss/extensions` on
  macOS/Linux, `%USERPROFILE%\.vscode-oss\extensions` on Windows) for source, pinned state, and install date.
  Rows use the same shape: display name (from the extension's `package.json`), publisher id, then
  version · source · pinned · date.
- **Details** — description, install count, last update, installed version, then
  `Install latest`, `Choose version…`, and — when the extension is installed — `Uninstall` (confirmed first,
  then `codium --uninstall-extension` and a poll until it disappears from the list).
  Version lists are filtered to `universal` and this machine's native build (`linux-x64`, `darwin-arm64`,
  `win32-x64`, …), newest first, with prereleases tagged.
- **Install** — live phase, progress bar and the piped `codium` output. `esc` cancels cooperatively.

## CLI

```sh
./run.sh --list
./run.sh --probe dbaeumer.vscode-eslint
./run.sh --install dbaeumer.vscode-eslint            # latest stable
./run.sh --install dbaeumer.vscode-eslint@3.0.24     # exact version
./run.sh --install <id> --dry-run                    # resolve only
./run.sh --list --extensions-dir /tmp/ext --user-data-dir /tmp/data
./run.sh --help
```

## Layout

```
run.sh             POSIX launcher (resolves its own directory)
run.cmd            Windows cmd launcher
run.ps1            Windows PowerShell launcher
src/
  main.ts          CLI entry and headless modes
  models.ts        pure data types: version ordering, platform selection, list parsing
  marketplace.ts   extensionquery search/versions and streamed download with sha256 check
  installed.ts     codium --list-extensions + extensions.json metadata
  installer.ts     work dir, VSIX validation, codium subprocess, post-install verification
  log.ts           per-platform cache directory and app.log
  theme.ts         Tokyo Night palette, square borders
  ui/              app shell (header/body/footer, screen stack) and the main, details,
                   version, install, and confirmation screens
tests/             node:test — models, marketplace parsing, installer pipeline, UI via createTestRenderer
```

Downloads and installs happen under a per-user cache directory (`~/.cache/codium-ext-tui` on Linux,
`~/Library/Caches/codium-ext-tui` on macOS, `%LOCALAPPDATA%\codium-ext-tui\cache` on Windows) in
`work/<uuid>/`, which is removed in a `finally` block. Each install start also sweeps work directories
older than an hour. A log is written alongside it in `app.log`.

## Tests

```sh
npm test          # node --experimental-ffi --test tests/*.test.ts
npm run typecheck # tsc --noEmit
```

## Marketplace notes

- `POST /_apis/public/gallery/extensionquery`, no cookies required.
- `flags: 2423` is required; smaller values (e.g. the browser's `870`) return a single version per extension.
- A search response carries only one version entry per extension, so version lists are always re-fetched by exact id.
- The gallery returns one entry per target platform. Only `universal` and the host's native build are kept,
  preferring the native build (`linux-x64`, `darwin-arm64`, `win32-x64`, …).
- `?targetPlatform=` is appended to the download URL **only** for platform-specific builds; adding it to a universal
  build returns 404.
