import type { CodiumInstaller } from "../installer.ts"
import type { InstalledExtension } from "../models.ts"
import type { CodiumOptions } from "../installed.ts"
import type { MarketplaceClient } from "../marketplace.ts"

export interface Deps {
  client: MarketplaceClient
  installer: CodiumInstaller
  listInstalled?: (options?: CodiumOptions) => Promise<InstalledExtension[]>
}
