"use client"

import { CircleCheckIcon } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/status-pill"
import { formatNumber } from "@/lib/format"
import type { SetupFacts } from "@/lib/setup/steps"
import { cn } from "@/lib/utils"

const IMPORT = {
  running: { tone: "info", label: "Running" },
  done: { tone: "ok", label: "Complete" },
  failed: { tone: "bad", label: "Stopped · retry from the client page" },
  not_started: { tone: "neutral", label: "Not started" },
} as const

/**
 * The end of the flow: what was set up, from the derived setup state, and
 * where the actual work happens.
 */
function StepDone({
  clientId,
  clientName,
  facts,
}: {
  clientId: string
  clientName: string
  facts: SetupFacts
}) {
  const connectionActive = facts.connection?.status === "active"
  const importState = IMPORT[facts.backfill]
  return (
    <div className="flex flex-col items-start gap-5">
      <span
        aria-hidden
        className="grid size-14 place-items-center rounded-2xl bg-success-tint text-success-ink"
      >
        <CircleCheckIcon className="size-7" strokeWidth={1.75} />
      </span>
      <p className="max-w-[56ch] text-body text-ink">
        {clientName} is connected. New reviews appear in your inbox as Google
        sends them.
      </p>
      <dl
        data-testid="setup-summary"
        className="grid w-full grid-cols-1 gap-x-6 gap-y-1 rounded-(--np-radius-card) border border-line bg-surface-alt p-4 text-ui @min-[520px]/wiz:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] @min-[520px]/wiz:gap-y-2.5"
      >
        <dt className="text-ink-muted">Google login</dt>
        <dd className="mb-2 @min-[520px]/wiz:mb-0">
          {facts.connection ? (
            <StatusPill tone={connectionActive ? "ok" : "bad"}>
              {connectionActive ? "Connected" : "Needs reconnecting"}
            </StatusPill>
          ) : (
            <StatusPill tone="neutral" dashed>
              No login linked yet
            </StatusPill>
          )}
        </dd>
        <dt className="text-ink-muted">Business Profile accounts</dt>
        <dd className="mb-2 font-mono tabular-nums @min-[520px]/wiz:mb-0">
          {formatNumber(facts.accountsActive)} selected
        </dd>
        <dt className="text-ink-muted">Listings linked</dt>
        <dd className="mb-2 font-mono tabular-nums @min-[520px]/wiz:mb-0">
          {formatNumber(facts.locationsLinked)}
        </dd>
        <dt className="text-ink-muted">Review import</dt>
        <dd className="mb-2 @min-[520px]/wiz:mb-0">
          <StatusPill tone={importState.tone}>{importState.label}</StatusPill>
        </dd>
        <dt className="text-ink-muted">Real-time notifications</dt>
        <dd className="mb-2 @min-[520px]/wiz:mb-0">
          {facts.notificationsEnabled
            ? "On"
            : "Off · reviews arrive on the scheduled check"}
        </dd>
        <dt className="text-ink-muted">Team</dt>
        <dd>
          {facts.teamInvited ? "Teammates added or invited" : "Only you so far"}
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Link href={`/clients/${clientId}`} className={cn(buttonVariants())}>
          Open the client
        </Link>
        <Link
          href={`/inbox?clientId=${clientId}`}
          className={cn(buttonVariants({ variant: "secondary" }))}
        >
          Open the inbox
        </Link>
        {/* The listings are what was just linked, and the board is where
            each one's health and verification show from the first visit. */}
        <Link
          href={`/listings?clientId=${clientId}`}
          className={cn(buttonVariants({ variant: "ghost" }))}
        >
          Open its listings
        </Link>
      </div>
    </div>
  )
}

export { StepDone }
