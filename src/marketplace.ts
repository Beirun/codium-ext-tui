import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { rm } from "node:fs/promises"
import type { ExtensionCandidate, VersionEntry } from "./models.ts"
import { selectCompatible } from "./models.ts"

const MARKETPLACE_URL = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery"
const DOWNLOAD_BASE = "https://marketplace.visualstudio.com/_apis/public/gallery/publishers"
const HEADERS: Record<string, string> = {
  Accept: "application/json;api-version=7.2-preview.1;excludeUrls=true",
  "Content-Type": "application/json",
  "User-Agent": "codium-ext-tui/0.1",
}
/** IncludeVersions|Files|CategoryAndTags|VersionProperties|ExcludeNonValidated|InstallationTargets|Statistics|2048 */
const FLAGS = 2423
const TARGET = "Microsoft.VisualStudio.Code"

export class MarketplaceError extends Error {}
export class NotFoundError extends MarketplaceError {}
export class RateLimitedError extends MarketplaceError {
  readonly retryAfter: number | null
  constructor(message: string, retryAfter: number | null = null) {
    super(message)
    this.retryAfter = retryAfter
  }
}
export class DownloadError extends Error {}
export class DownloadCancelled extends Error {}

export interface Cancellation {
  cancelled: boolean
}

export interface DownloadProgress {
  received: number
  total: number | null
}

interface RawVersion {
  version?: string
  targetPlatform?: string | null
  properties?: Array<{ key?: string; value?: string }>
}

interface RawExtension {
  publisher?: { publisherName?: string; displayName?: string }
  extensionName?: string
  displayName?: string
  shortDescription?: string
  lastUpdated?: string
  statistics?: Array<{ statisticName?: string; value?: number }>
  versions?: RawVersion[]
}

function property(version: RawVersion, key: string): string | null {
  const found = version.properties?.find((entry) => entry.key === key)
  return found?.value ?? null
}

function downloadUrl(publisher: string, name: string, version: string, platform: string): string {
  const base = `${DOWNLOAD_BASE}/${encodeURIComponent(publisher)}/vsextensions/${encodeURIComponent(name)}/${encodeURIComponent(version)}/vspackage`
  return platform === "universal" ? base : `${base}?targetPlatform=${encodeURIComponent(platform)}`
}

function parseVersion(raw: RawVersion, publisher: string, name: string): VersionEntry | null {
  if (!raw.version) return null
  const platform = raw.targetPlatform && raw.targetPlatform.length > 0 ? raw.targetPlatform : "universal"
  return {
    version: raw.version,
    targetPlatform: platform,
    downloadUrl: downloadUrl(publisher, name, raw.version, platform),
    prerelease: property(raw, "Microsoft.VisualStudio.Code.PreRelease") === "true",
    sha256: property(raw, "Microsoft.VisualStudio.Services.VsixSha256"),
  }
}

export function candidateFromRaw(raw: RawExtension): ExtensionCandidate | null {
  const publisher = raw.publisher?.publisherName
  const name = raw.extensionName
  if (!publisher || !name) return null
  const installs = raw.statistics?.find((entry) => entry.statisticName === "install")?.value
  return {
    publisher,
    name,
    displayName: raw.displayName ?? name,
    description: raw.shortDescription ?? "",
    installCount: typeof installs === "number" ? installs : null,
    lastUpdated: raw.lastUpdated ?? null,
    versions: (raw.versions ?? [])
      .map((version) => parseVersion(version, publisher, name))
      .filter((version): version is VersionEntry => version !== null),
  }
}

export class MarketplaceClient {
  private readonly timeoutMs: number
  private readonly cache = new Map<string, ExtensionCandidate>()

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  private async query(criteria: Array<{ filterType: number; value: string }>, pageSize: number): Promise<RawExtension[]> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let response: Response
    try {
      response = await fetch(MARKETPLACE_URL, {
        method: "POST",
        headers: HEADERS,
        signal: controller.signal,
        body: JSON.stringify({
          filters: [{ criteria, pageNumber: 1, pageSize, sortBy: 0, sortOrder: 0 }],
          assetTypes: [],
          flags: FLAGS,
        }),
      })
    } catch (error) {
      throw new MarketplaceError(describeNetworkError(error))
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 403 || response.status === 429) {
      const header = response.headers.get("retry-after")
      const retryAfter = header ? Number.parseInt(header, 10) : null
      throw new RateLimitedError(
        `marketplace rate limited (${response.status})`,
        Number.isFinite(retryAfter) ? retryAfter : null,
      )
    }
    if (!response.ok) {
      throw new MarketplaceError(`marketplace returned HTTP ${response.status}`)
    }
    const payload = (await response.json()) as { results?: Array<{ extensions?: RawExtension[] }> }
    return payload.results?.[0]?.extensions ?? []
  }

  async search(query: string, limit = 50): Promise<ExtensionCandidate[]> {
    const trimmed = query.trim()
    if (trimmed.length === 0) return []
    const raw = await this.query(
      [
        { filterType: 8, value: TARGET },
        { filterType: 10, value: trimmed },
      ],
      limit,
    )
    const candidates: ExtensionCandidate[] = []
    for (const entry of raw) {
      const parsed = candidateFromRaw(entry)
      if (parsed) candidates.push(parsed)
    }
    return candidates
  }

  async getVersions(id: string, options: { refresh?: boolean } = {}): Promise<ExtensionCandidate> {
    const key = id.toLowerCase()
    if (!options.refresh) {
      const cached = this.cache.get(key)
      if (cached) return cached
    }
    const raw = await this.query([{ filterType: 7, value: id }], 1)
    const first = raw[0]
    const candidate = first ? candidateFromRaw(first) : null
    if (!candidate) throw new NotFoundError(`extension not found: ${id}`)
    const compatible = selectCompatible(candidate.versions, { includePrerelease: true })
    if (compatible.length === 0) {
      throw new NotFoundError(`no linux-x64 or universal build for ${id}`)
    }
    const resolved: ExtensionCandidate = { ...candidate, versions: compatible }
    this.cache.set(key, resolved)
    return resolved
  }

  async download(
    entry: VersionEntry,
    destination: string,
    options: { onProgress?: (progress: DownloadProgress) => void; cancellation?: Cancellation } = {},
  ): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120_000)
    try {
      const response = await fetch(entry.downloadUrl, {
        headers: { "Accept-Encoding": "identity", "User-Agent": HEADERS["User-Agent"] as string },
        signal: controller.signal,
      })
      if (response.status === 404) throw new DownloadError(`download 404: ${entry.downloadUrl}`)
      if (!response.ok) throw new DownloadError(`download failed with HTTP ${response.status}`)
      if (!response.body) throw new DownloadError("download returned an empty body")

      const lengthHeader = response.headers.get("content-length")
      const total = lengthHeader ? Number.parseInt(lengthHeader, 10) : null
      const hash = createHash("sha256")
      const stream = createWriteStream(destination)
      let received = 0
      try {
        for await (const chunk of response.body) {
          if (options.cancellation?.cancelled) throw new DownloadCancelled("download cancelled")
          const buffer = Buffer.from(chunk as Uint8Array)
          received += buffer.length
          hash.update(buffer)
          if (!stream.write(buffer)) {
            await new Promise<void>((resolve) => stream.once("drain", resolve))
          }
          options.onProgress?.({ received, total: Number.isFinite(total) ? total : null })
        }
        await new Promise<void>((resolve, reject) => {
          stream.end((error?: Error | null) => (error ? reject(error) : resolve()))
        })
      } catch (error) {
        stream.destroy()
        throw error
      }

      const actual = hash.digest("hex")
      if (entry.sha256 && entry.sha256.toLowerCase() !== actual) {
        throw new DownloadError(`sha256 mismatch: expected ${entry.sha256}, got ${actual}`)
      }
    } catch (error) {
      await rm(destination, { force: true })
      if (error instanceof DownloadCancelled) throw error
      if (error instanceof DownloadError) throw error
      if (error instanceof Error && error.name === "AbortError") {
        throw new DownloadError("download timed out")
      }
      throw new DownloadError(describeNetworkError(error))
    } finally {
      clearTimeout(timer)
    }
  }
}

function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    if (cause instanceof Error) return `${error.message}: ${cause.message}`
    return error.message
  }
  return String(error)
}
