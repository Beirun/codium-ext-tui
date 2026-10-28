# Architecture

`codium-ext` is a terminal application for finding extensions on the Microsoft Marketplace and
installing them into VSCodium. It runs on Node's built-in TypeScript type stripping (no build step)
and renders with `@opentui/core`, a Zig core driven through Node's experimental FFI.

## Entry points

| Entry | Purpose |
| --- | --- |
| `bin/codium-ext.js` | CLI shim. Re-execs `src/main.ts` with `--experimental-ffi` and forwards argv. |
| `npm run dev` | Same program without the shim, for development. |

`src/main.ts` parses arguments with `node:util.parseArgs` and either runs a headless mode
(`--list`, `--probe`, `--install`, `--help`) or starts the TUI.

## Layers

```
 ┌──────────────────────────────┐
 │ ui/  (OpenTUI renderables)   │  screens, layout, key handling
 └──────────────┬───────────────┘
                │ Deps { client, installer, listInstalled }
 ┌──────────────▼───────────────┐
 │ marketplace.ts installer.ts  │  network + install orchestration
 │ installed.ts models.ts       │  VSCodium integration + pure logic
 └──────────────┬───────────────┘
                │ fetch / child_process / fs
 ┌──────────────▼───────────────┐
 │ Microsoft Marketplace,       │
 │ codium CLI, local filesystem │
 └──────────────────────────────┘
```

`ui/deps.ts` defines the `Deps` interface. `main.ts` injects the real `MarketplaceClient` and
`CodiumInstaller`; tests inject fakes or partial doubles, which keeps the UI testable without network
or a VSCodium install.

## Data model (`src/models.ts`)

- `ExtensionCandidate` — publisher, name, display name, description, install count, last update,
  and a list of `VersionEntry`.
- `VersionEntry` — version, gallery `targetPlatform`, download URL, prerelease flag, optional sha256.
- `InstalledExtension` — id, display name, version, source, pinned, install timestamp, target platform.

The module is pure: no I/O and no imports outside itself. It holds version comparison (prereleases
sort below releases), `selectCompatible`, `latestStable`, and parsing of `codium --list-extensions`
output.

### Platform selection

The gallery returns one version entry per `targetPlatform`. `runtimePlatform()` maps Node's
`process.platform`/`process.arch` to the gallery key (`linux-x64`, `darwin-arm64`, `win32-x64`,
`linux-armhf`, …). `selectCompatible` keeps entries whose platform is `universal` or the host's native
key, one entry per version, preferring the native build. Callers may pass an explicit `platform` for
deterministic tests.

## Marketplace client (`src/marketplace.ts`)

- `search` posts to the gallery `extensionquery` endpoint with filter type 8 (target =
  `Microsoft.VisualStudio.Code`) and 10 (search text). `flags: 2423` asks for all versions, files and
  properties.
- `getVersions` re-queries by exact id (filter type 7) because a search response carries only one
  version; results are filtered by `selectCompatible` and cached per client instance.
- `download` streams the VSIX with `fetch`, reporting `content-length` progress, hashing with SHA-256
  as chunks arrive, comparing against `VersionEntry.sha256` when the gallery supplies it, and honouring
  cancellation between chunks. The file is removed on any failure.
- Errors: `MarketplaceError`, `NotFoundError`, `RateLimitedError` (with `Retry-After`), `DownloadError`,
  `DownloadCancelled`.

## Install pipeline (`src/installer.ts`)

`CodiumInstaller.install` serializes calls with a promise-chain lock, so two installs never overlap.
Each run:

1. Creates `CACHE_ROOT/work/<uuid>/` after sweeping work directories older than one hour.
2. Downloads `publisher.name-version-platform.vsix` into that directory.
3. Validates the VSIX: extracts `extension.vsixmanifest` with the first working tool of `bsdtar`,
   `tar`, `unzip`; parses the `<Identity>` element and requires `Id`, `Publisher`, and `Version` to
   match the requested extension.
4. Runs `codium --install-extension <file> --force` (plus `--user-data-dir`/`--extensions-dir` when
   configured) through `spawnCommand`, streaming output to the UI, with a five-minute timeout.
5. Polls `listInstalled` every 1.5s until the version appears (`pollTimeoutMs`, default 60s), reporting
   `installed: false` rather than failing if `codium` succeeded but the list does not update.
6. Removes the work directory in a `finally` block.

`uninstall` runs `codium --uninstall-extension` under the same lock and polls until the id disappears.

Errors: `InstallError`, `CorruptVsix`, `CodiumError` (with exit code), `InstallCancelled`.

Cancellation is cooperative: callers share a `Cancellation` object; the installer polls it every 200ms
and sends `SIGTERM`, escalating to `SIGKILL` after five seconds.

## VSCodium integration (`src/installed.ts`)

- `runCommand` captures stdout/stderr with a timeout; `spawnCommand` is the Windows-aware variant that
  shells out through `cmd.exe` so `.cmd` shims such as `codium.cmd` resolve.
- `listInstalled` calls `codium --list-extensions --show-versions`, parses the output, then enriches
  each entry from `extensions.json` in the extensions directory (default `~/.vscode-oss/extensions`):
  `source`, `pinned`, `installedTimestamp`, `targetPlatform`, and the display name read from the
  extension's own `package.json`. Metadata is best-effort; the CLI listing is authoritative.

## TUI (`src/ui/`)

`App` owns the `CliRenderer` and a three-row shell (header, body, footer). Screens are pushed onto a
stack; only the top screen is visible and receives keys. `Navigator` (implemented by `App`) exposes
`push`, `pop`, `setStatus`, and the renderer. `q` quits unless a text input has focus.

| Screen | Role |
| --- | --- |
| `MainScreen` | Search input, Search/Installed tabs, hand-built three-line rows (`ExtensionList`), focus chain across tabs → input → list |
| `DetailsScreen` | Metadata, installed version, and the Install/Choose version/Uninstall actions |
| `VersionScreen` | Compatible versions for an extension |
| `InstallScreen` | Phase text, progress, piped `codium` output, cancel on `esc` |
| `ConfirmScreen` | Yes/no confirmation before destructive actions |

`ExtensionList` is a `ScrollBoxRenderable` of custom rows because `SelectRenderable` cannot render the
multi-line layout the lists need.

## Storage and logging (`src/log.ts`)

`CACHE_ROOT` is `~/.cache/codium-ext-tui` on Linux, `~/Library/Caches/codium-ext-tui` on macOS, and
`%LOCALAPPDATA%\codium-ext-tui\cache` on Windows. Work directories live under `work/`; `app.log`
receives timestamped phases, install results, and errors. Logging never throws.

## Testing

`npm test` runs `node:test` suites against the TypeScript sources directly:

- `models.test.ts` — pure logic; platform-sensitive cases pass an explicit `platform`.
- `marketplace.test.ts` — gallery payload parsing and URL construction.
- `installer.test.ts` — validation fixtures built with `bsdtar`, a fake `codium` script, and the full
  pipeline including cancellation.
- `ui.test.ts` — `createTestRenderer` from `@opentui/core/testing`, driving keys and asserting frames.

`npm run typecheck` runs `tsc --noEmit` with `strict` and `noUncheckedIndexedAccess`.

## Invariants

- No build step: Node executes `.ts` directly; imports name `.ts` explicitly.
- `models.ts` stays free of I/O.
- Platform handling stays dynamic; nothing hardcodes `linux-x64` outside tests.
- Every subprocess goes through `spawnCommand`; every zip read has a fallback tool.
- Only one install or uninstall runs at a time.
