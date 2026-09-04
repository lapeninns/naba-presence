"use client"

import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import * as React from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { QueryStates } from "@/components/ui/query-states"
import { Stepper } from "@/components/ui/stepper"
import { PageHeader } from "@/components/app-shell/page-frame"
import { SETUP_STEPS, type SetupStep } from "@/lib/contracts/clients"
import { useClient, useClientSetup } from "@/lib/queries/use-clients"
import {
  canVisit,
  stepDefinition,
  stepIndex,
  stepperState,
} from "@/lib/setup/steps"

import { StepAccount } from "./step-account"
import { StepAgency } from "./step-agency"
import { StepBackfill } from "./step-backfill"
import { StepConnect } from "./step-connect"
import { StepDone } from "./step-done"
import { StepLocations } from "./step-locations"
import { StepNotifications } from "./step-notifications"
import { StepTeam } from "./step-team"

function isStep(value: string | null): value is SetupStep {
  return value !== null && (SETUP_STEPS as readonly string[]).includes(value)
}

/**
 * Client setup, as a resumable flow.
 *
 * Nothing about the operator's progress is stored. `GET /api/clients/[id]/setup`
 * derives every answer from data that had to exist anyway, so refreshing,
 * going back, or picking this up tomorrow all land in the same place — and a
 * step undone elsewhere (a Google login that expired) correctly moves the flow
 * backwards rather than claiming to be finished.
 *
 * The step lives in the URL so a half-finished setup is a link an operator can
 * send to a colleague.
 */
function SetupWizard({ clientId }: { clientId: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const setupQuery = useClientSetup(clientId)
  const clientQuery = useClient(clientId)

  const furthest = setupQuery.data?.setup.nextStep ?? "connect"
  const requested = params.get("step")
  // The URL may name a step the data has not reached — a stale link, or a
  // Back button after something was disconnected. Fall back to where the flow
  // actually is rather than showing a step whose prerequisites are missing.
  const current: SetupStep =
    isStep(requested) && canVisit(requested, furthest) ? requested : furthest

  const definition = stepDefinition(current)
  const goTo = (step: SetupStep) => {
    const next = new URLSearchParams(params.toString())
    next.set("step", step)
    router.replace(`/setup?${next}`)
  }
  const advance = () => {
    const index = stepIndex(current)
    const nextStep = SETUP_STEPS[Math.min(index + 1, SETUP_STEPS.length - 1)]
    void setupQuery.refetch()
    goTo(nextStep)
  }
  const back = () => {
    const index = stepIndex(current)
    if (index > 0) goTo(SETUP_STEPS[index - 1])
  }

  const clientName = clientQuery.data?.client.name

  return (
    <QueryStates
      status={
        setupQuery.isPending ? "pending" : setupQuery.isError ? "error" : "ready"
      }
      error="We couldn't load this client's setup"
      onRetry={() => void setupQuery.refetch()}
    >
      {() => (
        <>
          <PageHeader
            title="Client setup"
            eyebrow={clientName ? `Setting up ${clientName}` : "Setting up"}
            actions={
              <Link
                href={`/clients/${clientId}`}
                className={buttonVariants({ variant: "ghost" })}
              >
                Finish later
              </Link>
            }
          />

          <div className="flex flex-col gap-8 lg:flex-row">
            <div className="lg:w-56 lg:shrink-0">
              <Stepper
                orientation="vertical"
                aria-label="Setup steps"
                steps={stepperState(current, furthest).map((step) => ({
                  id: step.id,
                  label: step.label,
                  state: step.state,
                }))}
              />
            </div>

            <section
              aria-labelledby="setup-step-title"
              className="flex min-w-0 flex-1 flex-col rounded-(--np-radius-card) border border-line bg-surface"
            >
              <div className="flex flex-col gap-1.5 border-b border-line-subtle px-6 py-5">
                <p className="text-caption font-medium text-ink-muted">
                  Step {stepIndex(current) + 1} of {SETUP_STEPS.length - 1}
                </p>
                <h2 id="setup-step-title" className="font-display text-section">
                  {definition.title}
                </h2>
                <p className="max-w-prose text-ui text-ink-muted">
                  {definition.description}
                </p>
              </div>

              <div className="flex flex-1 flex-col gap-4 px-6 py-5">
                <StepBody
                  step={current}
                  clientId={clientId}
                  clientName={clientName ?? "this client"}
                  onAdvance={advance}
                />
              </div>

              {current === "done" ? null : (
                <div className="flex items-center justify-between gap-3 border-t border-line-subtle px-6 py-4">
                  <Button
                    variant="ghost"
                    onClick={back}
                    disabled={stepIndex(current) === 0}
                  >
                    Back
                  </Button>
                  <div className="flex items-center gap-3">
                    <p className="hidden text-caption text-ink-muted sm:block">
                      You can come back to any step later
                    </p>
                    <Button onClick={advance}>
                      {definition.optional ? "Skip for now" : "Continue"}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </QueryStates>
  )
}

function StepBody({
  step,
  clientId,
  clientName,
  onAdvance,
}: {
  step: SetupStep
  clientId: string
  clientName: string
  onAdvance: () => void
}) {
  switch (step) {
    case "agency":
      return <StepAgency />
    case "client":
      return <StepClientSummary clientId={clientId} clientName={clientName} />
    case "connect":
      return <StepConnect clientId={clientId} clientName={clientName} />
    case "account":
      return <StepAccount />
    case "locations":
      return <StepLocations clientId={clientId} clientName={clientName} />
    case "backfill":
      return <StepBackfill onAdvance={onAdvance} />
    case "notifications":
      return <StepNotifications />
    case "team":
      return <StepTeam clientName={clientName} />
    case "done":
      return <StepDone clientId={clientId} clientName={clientName} />
  }
}

/**
 * The client already exists by the time the wizard runs — it is created before
 * this flow starts — so this step confirms rather than asks again.
 */
function StepClientSummary({
  clientId,
  clientName,
}: {
  clientId: string
  clientName: string
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-body">
        You&rsquo;re setting up <strong className="font-medium">{clientName}</strong>.
      </p>
      <Link
        href={`/clients/${clientId}/settings`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Rename or add notes
      </Link>
    </div>
  )
}

export { SetupWizard }
