"use client"

import { UserRoundCog } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { endImpersonation } from "@/lib/api/auth"

/**
 * Shown on every page of a support impersonation session.
 *
 * Every other part of the shell describes the customer whose identity the
 * session carries, so without this nothing tells the support engineer (or a
 * screenshot of their screen) that the actions are theirs. "End
 * impersonation" calls DELETE /api/support/impersonation, which records
 * `support.impersonation.ended` before clearing the session, so the audit
 * trail has an end for every start instead of waiting out the one-hour
 * expiry.
 */
export function ImpersonationBanner({
  supportActor,
  customerName,
  organisationName,
}: {
  supportActor: string
  customerName: string
  organisationName: string
}) {
  const [ending, setEnding] = React.useState(false)

  const onEnd = async () => {
    setEnding(true)
    try {
      await endImpersonation()
    } catch {
      // The session may already have expired; either way it is over here.
    } finally {
      window.location.assign("/sign-in")
    }
  }

  return (
    <div
      role="status"
      data-slot="impersonation-banner"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-warning-tint px-5 py-2 text-ui text-ink sm:py-2.5 md:px-(--np-page-pad-x)"
    >
      <UserRoundCog
        className="size-4 shrink-0 text-warning-ink"
        strokeWidth={1.75}
        aria-hidden
      />
      <p className="min-w-0 flex-[1_1_12rem] text-pretty [overflow-wrap:anywhere]">
        <strong className="font-semibold">
          Support session: {supportActor} is acting as {customerName}
        </strong>{" "}
        <span className="text-ink-secondary">
          in {organisationName}. Every change is recorded against your name.
        </span>
      </p>
      <Button
        variant="outline"
        size="sm"
        pending={ending}
        pendingLabel="Ending…"
        onClick={() => void onEnd()}
      >
        End impersonation
      </Button>
    </div>
  )
}
