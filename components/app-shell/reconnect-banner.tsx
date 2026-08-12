"use client"

import { TriangleAlertIcon } from "lucide-react"
import Link from "next/link"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { useQuery } from "@tanstack/react-query"

import { fetchConnections } from "@/lib/api/connections"
import { queryKeys } from "@/lib/queries/keys"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  return date.toLocaleString("en-GB")
}

/**
 * Persistent shell banner for Google disconnect / reconnect-required states.
 * Complements StatusChip and Home's DisconnectedBanner with a dashboard-wide CTA.
 */
export function ReconnectBanner() {
  const { status } = useConnectionHealth()
  const connections = useQuery({
    queryKey: queryKeys.connections,
    queryFn: fetchConnections,
    staleTime: 60_000,
  })

  const list = connections.data?.connections ?? []
  const problem =
    list.find((c) => c.reconnectRequired) ??
    list.find((c) => c.status !== "active") ??
    null
  const reconnectRequired = list.some((c) => c.reconnectRequired)
  const show =
    status === "disconnected" || status === "error" || reconnectRequired
  if (!show) return null

  const lastRefresh = formatWhen(problem?.lastRefreshAt)
  const lastError = problem?.lastErrorCode
    ? problem.lastErrorCode.replace(/_/g, " ")
    : null

  const title = reconnectRequired
    ? "Google needs reconnecting"
    : status === "error"
      ? "Google connection status unavailable"
      : "Google is not connected"

  const description = reconnectRequired
    ? [
        "Your Google connection requires attention. Reconnect to resume syncing reviews, photos, and location updates.",
        lastError ? `Last error: ${lastError}.` : null,
        lastRefresh ? `Last successful refresh: ${lastRefresh}.` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : status === "error"
      ? "We could not confirm the Google connection. Check Settings and try again."
      : "No active Google connection exists, so live Google data cannot stay up to date. Reviews, photos, and location edits will not sync until you reconnect."

  return (
    <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
      <TriangleAlertIcon aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{description}</span>
        <Link
          href="/settings/connections"
          prefetch={false}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Manage connection
        </Link>
      </AlertDescription>
    </Alert>
  )
}
