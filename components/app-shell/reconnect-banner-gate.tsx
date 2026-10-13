"use client"

import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"

import { useClients } from "@/lib/queries/use-clients"
import { useConnectionsQuery } from "@/lib/queries/use-connections-query"

import { useClientScope } from "./client-context"
import {
  hidesReconnectBanner,
  lostListingAccess,
  needsReconnect,
} from "./reconnect-banner-rules"

// The banner, its reconnect dialog (Settings' connection card) and the
// error copy load only when there is something to say. The layout hydrates
// the connections and clients, so when there is, the server renders the
// banner and its chunk is part of that page's HTML: no late shift.
const ReconnectBanner = dynamic(() =>
  import("./reconnect-banner").then((m) => m.ReconnectBanner)
)

/**
 * The shell's slot for the organisation-wide reconnect banner
 * (./reconnect-banner.tsx). It reads the same cached queries and applies the
 * same rules (./reconnect-banner-rules.ts) to decide whether the banner has
 * anything to show; the banner still makes the final call (dismissal).
 */
export function ShellReconnectBanner() {
  const pathname = usePathname()
  const clientId = useClientScope()
  const clients = useClients()
  const query = useConnectionsQuery()

  if (hidesReconnectBanner(pathname)) return null
  const broken = (query.data?.connections ?? []).some(needsReconnect)
  const scoped = clientId
    ? clients.data?.items.find((entry) => entry.id === clientId)
    : undefined
  if (!broken && !lostListingAccess(scoped)) return null
  return <ReconnectBanner />
}
