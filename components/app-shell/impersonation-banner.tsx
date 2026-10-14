"use client"

import { UserRoundCog } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { endImpersonation } from "@/lib/api/auth"
import { hardNavigate } from "@/lib/client/hard-navigate"
import { cn } from "@/lib/utils"

import { NOTICE_ACTION_CLASS, NOTICE_STRIP_CLASS } from "./shell-notices"

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
 *
 * Drawn as the shell's notice strip, but in charcoal rather than a status
 * tint: every other notice is about the workspace, this one is about who
 * is acting, so it must never be mistaken for one of them.
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
      hardNavigate("/sign-in")
    }
  }

  return (
    <div
      role="status"
      data-slot="impersonation-banner"
      className={cn(NOTICE_STRIP_CLASS, "on-charcoal")}
    >
      <UserRoundCog strokeWidth={1.75} aria-hidden />
      <p className="min-w-0 flex-[1_1_12rem] text-pretty [overflow-wrap:anywhere]">
        <strong className="font-semibold">
          Support session: {supportActor} is acting as {customerName}
        </strong>{" "}
        <span className="text-ink-muted-on-charcoal">
          in {organisationName}. Every change is recorded against your name.
        </span>
      </p>
      <Button
        variant="link"
        pending={ending}
        pendingLabel="Ending…"
        onClick={() => void onEnd()}
        className={cn(NOTICE_ACTION_CLASS, "text-ink-on-charcoal")}
      >
        End impersonation
      </Button>
    </div>
  )
}
