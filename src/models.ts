export interface VersionEntry {
  version: string
  targetPlatform: string
  downloadUrl: string
  prerelease: boolean
  sha256: string | null
}

export interface ExtensionCandidate {
  publisher: string
  name: string
  displayName: string
  description: string
  installCount: number | null
  lastUpdated: string | null
  versions: VersionEntry[]
}

export interface InstalledExtension {
  id: string
  displayName: string | null
  version: string
  source: string | null
  pinned: boolean
  installedAt: number | null
  targetPlatform: string | null
}

export const COMPATIBLE_PLATFORMS = ["universal", "linux-x64"] as const

export function extensionId(candidate: { publisher: string; name: string }): string {
  return `${candidate.publisher}.${candidate.name}`
}

export function splitExtensionId(raw: string): [string, string] {
  const trimmed = raw.trim()
  const dot = trimmed.indexOf(".")
  if (dot <= 0 || dot === trimmed.length - 1) {
    throw new Error(`invalid extension id: ${JSON.stringify(raw)}`)
  }
  return [trimmed.slice(0, dot), trimmed.slice(dot + 1)]
}

function parseVersionParts(version: string): { nums: number[]; pre: string } {
  const dash = version.indexOf("-")
  const core = dash === -1 ? version : version.slice(0, dash)
  const pre = dash === -1 ? "" : version.slice(dash + 1)
  const parts = core.split(".").map((segment) => {
    const n = Number.parseInt(segment, 10)
    return Number.isFinite(n) ? n : 0
  })
  while (parts.length < 3) parts.push(0)
  return { nums: parts, pre }
}

/** Ascending: > 0 means a is newer than b. Prereleases sort below their release. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersionParts(a)
  const pb = parseVersionParts(b)
  for (let i = 0; i < 3; i++) {
    const diff = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre === "") return 1
  if (pb.pre === "") return -1
  return pa.pre.localeCompare(pb.pre, "en", { numeric: true })
}

function normalizePlatform(platform: string | null | undefined): string {
  return platform && platform.length > 0 ? platform : "universal"
}

/**
 * The marketplace returns one version entry per target platform. Keep the ones
 * this machine can actually run, one entry per version, preferring linux-x64.
 */
export function selectCompatible(
  entries: readonly VersionEntry[],
  options: { includePrerelease?: boolean } = {},
): VersionEntry[] {
  const byVersion = new Map<string, VersionEntry>()
  for (const entry of entries) {
    const platform = normalizePlatform(entry.targetPlatform)
    if (!COMPATIBLE_PLATFORMS.includes(platform as (typeof COMPATIBLE_PLATFORMS)[number])) continue
    if (entry.prerelease && !options.includePrerelease) continue
    const normalized: VersionEntry = { ...entry, targetPlatform: platform }
    const existing = byVersion.get(normalized.version)
    if (!existing || (existing.targetPlatform === "universal" && platform === "linux-x64")) {
      byVersion.set(normalized.version, normalized)
    }
  }
  return [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version))
}

export function latestStable(entries: readonly VersionEntry[]): VersionEntry | null {
  const stable = selectCompatible(entries)
  if (stable.length > 0) return stable[0] ?? null
  const any = selectCompatible(entries, { includePrerelease: true })
  return any[0] ?? null
}

/** Parses `codium --list-extensions --show-versions` into casefolded id -> version. */
export function parseCodiumList(output: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const at = line.lastIndexOf("@")
    if (at <= 0) continue
    const id = line.slice(0, at)
    const version = line.slice(at + 1)
    if (id.length === 0 || version.length === 0) continue
    result.set(id.toLowerCase(), version)
  }
  return result
}

export function formatCount(value: number | null): string {
  if (value === null) return "-"
  return value.toLocaleString("en-US")
}

export function formatDate(iso: string | null): string {
  if (!iso) return "-"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().slice(0, 10)
}

export function formatTimestamp(ms: number | null): string {
  if (ms === null) return "-"
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toISOString().slice(0, 10)
}
