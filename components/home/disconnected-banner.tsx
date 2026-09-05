"use client"

import Link from "next/link"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"

function DisconnectedBanner() {
  const { status } = useConnectionHealth()
  if (status !== "disconnected") return null
  return (
    <Alert variant="destructive">
      <AlertTitle>Google is not connected</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>
          No active Google connection exists, so the figures below cannot be
          kept up to date. Reconnect Google to resume syncing your locations.
        </span>
        {/* /settings/connections 404s until M6; viewport-prefetch of a 404
            route destabilises Task 7's networkidle-based e2e guards - stay
            prefetch={false} (mirrors nav.tsx). */}
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

export { DisconnectedBanner }
