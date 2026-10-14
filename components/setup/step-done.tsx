"use client"

import { CircleCheckIcon } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { SettingsGroup, SettingsRow } from "@/components/ui/settings-row"
import { StatusPill } from "@/components/ui/status-pill"
import { formatNumber } from "@/lib/format"
import type { SetupFacts } from "@/lib/setup/steps"
import { cn } from "@/lib/utils"

const IMPORT = {
  running: { tone: "info", label: "Running" },
  done: { tone: "ok", label: "Complete" },
  failed: {
    tone: "bad",
    label: "Stopped",
    hint: "Retry it from the Import reviews step",
  },
  not_started: { tone: "neutral", label: "Not started" },
} as const

/**
 * The end of the flow: what was set up, from the derived setup state, and
 * where the actual work happens.
 */
function StepDone({
  clientId,
  clientName,
  business,
  facts,
}: {
  clientId: string
  clientName: string
  business: boolean
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
      <p className="max-w-(--np-measure-reading) text-body text-pretty text-ink">
        {business ? "Your business" : clientName} is connected. New reviews
        from Google appear in your inbox.
      </p>
      {/* Notion Mail's settings rows: a label, an optional line under it,
          and the value on the right. Static rows, nothing here is a control.
          Pills sit in the trailing slot (`action`) rather than `value`, so a
          long one can wrap on a 320px phone instead of pushing past the
          edge. */}
      <SettingsGroup data-testid="setup-summary" card className="mt-0 w-full">
        <SettingsRow
          label="Google login"
          action={
            facts.connection ? (
              <StatusPill tone={connectionActive ? "ok" : "bad"}>
                {connectionActive ? "Connected" : "Needs reconnecting"}
              </StatusPill>
            ) : (
              <StatusPill tone="neutral" dashed>
                No login linked yet
              </StatusPill>
            )
          }
        />
        <SettingsRow
          label="Business Profile accounts"
          value={
            <span className="tabular-nums">
              {formatNumber(facts.accountsActive)} selected
            </span>
          }
        />
        <SettingsRow
          label="Listings linked"
          value={
            <span className="tabular-nums">
              {formatNumber(facts.locationsLinked)}
            </span>
          }
        />
        <SettingsRow
          label="Review import"
          description={"hint" in importState ? importState.hint : undefined}
          action={
            <StatusPill tone={importState.tone}>{importState.label}</StatusPill>
          }
        />
        <SettingsRow
          label="Real-time notifications"
          description={
            facts.notificationsEnabled
              ? undefined
              : "Reviews arrive on the scheduled check"
          }
          value={facts.notificationsEnabled ? "On" : "Off"}
        />
        <SettingsRow
          label="Team"
          value={
            facts.teamInvited ? "Teammates added or invited" : "Only you so far"
          }
        />
      </SettingsGroup>
      <div className="flex w-full flex-col gap-2 @min-[520px]/wiz:w-auto @min-[520px]/wiz:flex-row @min-[520px]/wiz:flex-wrap">
        {business ? null : (
          <Link href={`/clients/${clientId}`} className={cn(buttonVariants())}>
            Open the client
          </Link>
        )}
        <Link
          href={business ? "/inbox" : `/inbox?clientId=${clientId}`}
          className={cn(
            buttonVariants({ variant: business ? "default" : "secondary" })
          )}
        >
          Open the inbox
        </Link>
        {/* The listings are what was just linked, and the board is where
            each one's health and verification show from the first visit. */}
        <Link
          href={business ? "/listings" : `/listings?clientId=${clientId}`}
          className={cn(buttonVariants({ variant: "ghost" }))}
        >
          {business ? "Open your listings" : "Open its listings"}
        </Link>
      </div>
    </div>
  )
}

export { StepDone }
