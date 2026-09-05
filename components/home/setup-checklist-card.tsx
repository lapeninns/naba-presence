"use client"

import { ListChecksIcon } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { useClients, useClientSetup } from "@/lib/queries/use-clients"
import { stepDefinition, stepIndex } from "@/lib/setup/steps"
import { SETUP_STEPS } from "@/lib/contracts/clients"

/**
 * A nudge on Home while the first client is still half-connected.
 *
 * Only for the first client, and only until it is finished: a permanent
 * checklist becomes furniture nobody reads. It reports the SAME derived step
 * the wizard resumes at, so the card and the flow cannot disagree about what
 * is left.
 */
function SetupChecklistCard({ role }: { role: string | null }) {
  const canManage = role === "owner" || role === "admin"
  const clients = useClients()
  // The oldest client is the one someone set up first; a later client's
  // half-finished setup belongs on that client's own page, not on Home.
  const first = [...(clients.data?.items ?? [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )[0]
  const setup = useClientSetup(canManage ? (first?.id ?? null) : null)

  if (!canManage || !first || !setup.data) return null
  const { nextStep } = setup.data.setup
  if (nextStep === "done") return null

  const done = stepIndex(nextStep)
  const total = SETUP_STEPS.length - 1
  const definition = stepDefinition(nextStep)

  return (
    <section
      aria-labelledby="setup-checklist"
      className="flex flex-col gap-3 rounded-(--np-radius-card) bg-accent-tint p-(--np-card-pad) sm:flex-row sm:items-center sm:gap-4"
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-(--np-radius-pill) bg-surface text-accent-ink"
      >
        <ListChecksIcon className="size-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="setup-checklist" className="text-body font-semibold text-ink">
          Finish setting up {first.name}
        </h2>
        <p className="text-ui text-accent-ink">
          Next: {definition.title.toLowerCase()}.
          <span className="tabular-nums">
            {" "}
            {done} of {total} steps done.
          </span>
        </p>
      </div>
      <Link
        href={`/setup?client=${first.id}&step=${nextStep}`}
        className={buttonVariants({ pill: true })}
      >
        Continue setup
      </Link>
    </section>
  )
}

export { SetupChecklistCard }
