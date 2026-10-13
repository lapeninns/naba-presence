import type { ConnectionSummary } from "@/lib/api/connections"
import type { ClientSummary } from "@/lib/contracts/clients"

/** The page that lists every connection with its own Reconnect. */
export const CONNECTIONS_PATH = "/settings/connections"

/** Settings › Google connections shows its own Reconnect for each login. */
export function hidesReconnectBanner(pathname: string | null): boolean {
  return (
    pathname === CONNECTIONS_PATH ||
    Boolean(pathname?.startsWith(`${CONNECTIONS_PATH}/`))
  )
}

/** A Google login the banner asks to reconnect. */
export function needsReconnect(connection: ConnectionSummary): boolean {
  return connection.reconnectRequired && connection.status !== "disconnected"
}

/** The scoped client's listing lost manager access (not a login problem). */
export function lostListingAccess(
  scoped: Pick<ClientSummary, "freshness"> | undefined
): boolean {
  return scoped?.freshness?.reason === "listing_access_lost"
}
