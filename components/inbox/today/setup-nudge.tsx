"use client"

import { ListChecksIcon } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { SETUP_STEPS, type SetupStep } from "@/lib/contracts/clients"
import { useClients, useClientSetup } from "@/lib/queries/use-clients"
import { stepDefinition, stepIndex } from "@/lib/setup/steps"

export type SetupNudge = {
  clientId: string
  clientName: string
  nextStep: SetupStep
  done: number
  total: number
  nextTitle: string
}

/**
 * Whether the first client is still half-connected, and what is left.
 *
 * Only the first client, and only until it is finished: a permanent checklist
 * becomes furniture nobody reads. It reports the SAME derived step the wizard
 * resumes at, so the nudge and the flow cannot disagree about what is left.
 * A separate hook so the Today strip can decide whether it has anything to
 * show before it draws its own frame.
 */
function useSetupNudge(role: string | null): SetupNudge | null {
  const canManage = role === "owner" || role === "admin"
  const clients = useClients()
  // The oldest client is the one someone set up first; a later client's
  // half-finished setup belongs on that client's own page.
  const first = [...(clients.data?.items ?? [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )[0]
  const setup = useClientSetup(canManage ? (first?.id ?? null) : null)

  if (!canManage || !first || !setup.data) return null
  const { nextStep } = setup.data.setup
  if (nextStep === "done") return null
  return {
    clientId: first.id,
    clientName: first.name,
    nextStep,
    done: stepIndex(nextStep),
    total: SETUP_STEPS.length - 1,
    nextTitle: stepDefinition(nextStep).title,
  }
}

/** The nudge itself: one tinted row with the next step and a way into it. */
function SetupNudgeCard({ nudge }: { nudge: SetupNudge }) {
  return (
    <div
      data-slot="setup-nudge"
      className="flex flex-col gap-3 rounded-(--np-radius-card) bg-accent-tint p-(--np-card-pad) sm:flex-row sm:items-center sm:gap-4"
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-(--np-radius-pill) bg-surface text-accent-ink"
      >
        <ListChecksIcon className="size-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-ink">
          Finish setting up {nudge.clientName}
        </p>
        <p className="text-ui text-accent-ink">
          Next: {nudge.nextTitle.toLowerCase()}.
          <span className="tabular-nums">
            {" "}
            {nudge.done} of {nudge.total} steps done.
          </span>
        </p>
      </div>
      <Link
        href={`/setup?client=${nudge.clientId}&step=${nudge.nextStep}`}
        className={buttonVariants({ pill: true })}
      >
        Continue setup
      </Link>
    </div>
  )
}

export { SetupNudgeCard, useSetupNudge }
