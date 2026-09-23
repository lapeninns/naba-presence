"use client"

import { ClockIcon } from "lucide-react"
import Link from "next/link"

import { ChipCount, chipClassName } from "@/components/ui/chip"
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

function setupHref(nudge: SetupNudge): string {
  return `/setup?client=${nudge.clientId}&step=${nudge.nextStep}`
}

/**
 * The nudge as a chip beside the attention chip (reference "Finish setting up
 * …"): what is left, and how far through the wizard the client is, in mono.
 */
function SetupNudgeChip({ nudge }: { nudge: SetupNudge }) {
  return (
    <Link
      href={setupHref(nudge)}
      data-slot="setup-nudge"
      className={chipClassName({ className: "max-w-full" })}
    >
      <ClockIcon aria-hidden strokeWidth={1.75} />
      <span className="truncate">Finish setup for {nudge.clientName}</span>
      <ChipCount aria-hidden>
        {nudge.done}/{nudge.total}
      </ChipCount>
      <span className="sr-only">
        : {nudge.nextTitle.toLowerCase()} next, {nudge.done} of {nudge.total}{" "}
        steps done
      </span>
    </Link>
  )
}

export { SetupNudgeChip, useSetupNudge }
