"use client"

import {
  ArrowLeftIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  InfoIcon,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Stepper } from "@/components/ui/stepper"
import { ValidationSummary } from "@/components/ui/validation-summary"
import { SETUP_STEPS, type SetupStep } from "@/lib/contracts/clients"
import { describeActionError } from "@/lib/errors/action-errors"
import { useClient, useClientSetup } from "@/lib/queries/use-clients"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { GOOGLE_RETURN_PARAMS } from "@/lib/setup/oauth-status"
import {
  resolveStep,
  stepBlocker,
  stepDefinition,
  stepIndex,
  stepperState,
  type SetupFacts,
} from "@/lib/setup/steps"
import { cn } from "@/lib/utils"

import { StepAccount } from "./step-account"
import { StepAgency } from "./step-agency"
import { StepBackfill } from "./step-backfill"
import { StepConnect } from "./step-connect"
import { StepDone } from "./step-done"
import { StepLocations } from "./step-locations"
import { StepNotifications } from "./step-notifications"
import { StepTeam } from "./step-team"

const TOTAL = SETUP_STEPS.length
const AGENCY_UNSAVED =
  "Save the new timezone, or change it back, before continuing."

/** The control a step's validation message moves focus to. */
function focusTargetFor(step: SetupStep): string {
  if (step === "connect") return "setup-connect-google"
  if (step === "agency") return "setup-agency-save"
  return "setup-step-content"
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
 * The step lives in the URL (`?step=`) so a half-finished setup is a link an
 * operator can send to a colleague. A step the data has not reached opens the
 * furthest reachable one instead, with a note saying why.
 *
 * Layout (reference `setup.html`): a sticky 220px step rail beside one card
 * from 720px of room; below that the rail folds into "Step N of 9" with a
 * progress bar and an "All steps" disclosure. The card's footer (Back, the
 * reason Continue is blocked, Continue) sticks to the bottom of the screen so
 * it is always reachable on a phone.
 */
function SetupWizard({ clientId }: { clientId: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const setupQuery = useClientSetup(clientId)
  const clientQuery = useClient(clientId)
  const { query: connectionsQuery } = useConnectionWorkspace()

  const [agencyDirty, setAgencyDirty] = React.useState(false)
  const [checking, setChecking] = React.useState(false)
  const [attempt, setAttempt] = React.useState<{
    step: SetupStep
    message: string
    key: number
  } | null>(null)
  const [stepsOpen, setStepsOpen] = React.useState(false)
  const titleRef = React.useRef<HTMLHeadingElement>(null)

  const clientName = clientQuery.data?.client.name
  const setup = setupQuery.data?.setup
  const usableLogin = (connectionsQuery.data?.connections ?? []).some(
    (connection) =>
      connection.status === "active" && !connection.reconnectRequired
  )
  const facts: SetupFacts | null = setup ? { ...setup, usableLogin } : null
  const resolved = facts
    ? resolveStep(params.get("step"), setup!.nextStep, facts)
    : null
  const current = resolved?.step ?? "connect"

  // Move focus to the new step's title when the step changes (not on the
  // first render), so keyboard and screen-reader users land on what changed.
  const shownStep = React.useRef<SetupStep | null>(null)
  React.useEffect(() => {
    if (!resolved) return
    if (shownStep.current && shownStep.current !== current) {
      titleRef.current?.focus()
    }
    shownStep.current = current
  }, [current, resolved])

  const hrefFor = (step: SetupStep) => {
    const next = new URLSearchParams(params.toString())
    for (const key of GOOGLE_RETURN_PARAMS) next.delete(key)
    next.set("step", step)
    return `/setup?${next}`
  }
  const goTo = (step: SetupStep) => {
    setAttempt(null)
    setStepsOpen(false)
    router.replace(hrefFor(step), { scroll: false })
  }

  const loading =
    setupQuery.isPending ||
    (connectionsQuery.isPending && !connectionsQuery.isError)

  if (setupQuery.isError) {
    return (
      <>
        <WizardHeader clientId={clientId} clientName={clientName} />
        <div className="rounded-(--np-radius-card) border border-line bg-surface">
          <Empty
            tone="bad"
            titleAs="h2"
            icon={<CircleAlertIcon />}
            title="We couldn’t load this client’s setup"
            description={`${describeActionError(setupQuery.error)} Without it we can’t tell which step comes next. Nothing was changed.`}
            action={
              <Button
                variant="secondary"
                pending={setupQuery.isFetching}
                pendingLabel="Trying again…"
                onClick={() => void setupQuery.refetch()}
              >
                Try again
              </Button>
            }
          />
        </div>
      </>
    )
  }

  if (loading || !facts || !resolved) {
    return (
      <>
        <WizardHeader clientId={clientId} clientName={clientName} />
        <WizardSkeleton />
      </>
    )
  }

  const definition = stepDefinition(current)
  const index = stepIndex(current)
  const isDone = current === "done"
  const blocker =
    current === "agency" && agencyDirty
      ? AGENCY_UNSAVED
      : stepBlocker(current, facts)
  const showSummary = attempt?.step === current
  const steps = stepperState(current, facts).map((step) => ({
    id: step.id,
    label: step.label,
    state: step.state,
    note: step.optional ? "Optional" : undefined,
    href: step.reachable && step.id !== current ? hrefFor(step.id) : undefined,
  }))
  const name = clientName ?? "this client"
  const importing = current === "backfill" && facts.backfill === "running"

  const advance = async () => {
    setChecking(true)
    // Re-read before deciding: the step's own card (accounts, listings,
    // import) saves through its own endpoint and does not refresh setup.
    const [fresh, logins] = await Promise.all([
      setupQuery.refetch(),
      connectionsQuery.refetch(),
    ])
    setChecking(false)
    const freshUsable = logins.data
      ? logins.data.connections.some(
          (connection) =>
            connection.status === "active" && !connection.reconnectRequired
        )
      : facts.usableLogin
    const freshFacts: SetupFacts = fresh.data
      ? { ...fresh.data.setup, usableLogin: freshUsable }
      : facts
    const reason =
      current === "agency" && agencyDirty
        ? AGENCY_UNSAVED
        : stepBlocker(current, freshFacts)
    if (reason) {
      setAttempt({ step: current, message: reason, key: Date.now() })
      return
    }
    goTo(SETUP_STEPS[Math.min(index + 1, TOTAL - 1)])
  }

  const footerHint = blocker
    ? blocker
    : definition.optional
      ? "Optional. You can skip this and come back later."
      : "You can come back to any step later."

  return (
    <>
      <WizardHeader clientId={clientId} clientName={clientName} />

      <div className="@container/setup">
        <div className="grid items-start gap-6 @min-[720px]/setup:grid-cols-[13.75rem_minmax(0,1fr)]">
          <nav
            aria-label="Setup progress"
            className="sticky top-[calc(var(--np-toolbar-h)+16px)] hidden flex-col gap-3 @min-[720px]/setup:flex"
          >
            <Stepper
              orientation="vertical"
              aria-label="Setup steps"
              steps={steps}
            />
            <p className="px-2.5 text-caption text-ink-muted">
              You can come back to any step later.
            </p>
          </nav>

          <section
            aria-labelledby="setup-step-title"
            data-step={current}
            className="@container/wiz flex min-w-0 flex-col rounded-(--np-radius-card) border border-line bg-surface"
          >
            <div className="flex flex-col gap-1 border-b border-line px-(--np-card-pad) pt-(--np-card-pad) pb-4">
              <div className="mb-2 flex flex-col gap-2 @min-[720px]/setup:hidden">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-caption font-semibold text-ink">
                    Step {index + 1} of {TOTAL} · {definition.label}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={stepsOpen}
                    aria-controls="setup-all-steps"
                    onClick={() => setStepsOpen((open) => !open)}
                    className="-mr-2"
                  >
                    All steps
                    <ChevronDownIcon
                      aria-hidden
                      className={cn(
                        "transition-transform duration-(--np-duration-fast)",
                        stepsOpen && "rotate-180"
                      )}
                    />
                  </Button>
                </div>
                <Progress
                  value={index + 1}
                  max={TOTAL}
                  label={`Setup progress: step ${index + 1} of ${TOTAL}`}
                />
                <div id="setup-all-steps" hidden={!stepsOpen}>
                  {stepsOpen ? (
                    <Stepper
                      orientation="vertical"
                      aria-label="Setup steps"
                      steps={steps}
                      className="mt-2 rounded-(--np-radius-card) border border-line bg-surface-alt p-1.5"
                    />
                  ) : null}
                </div>
              </div>
              {isDone ? null : (
                <p className="hidden text-caption font-semibold text-ink-secondary @min-[720px]/setup:block">
                  Step {index + 1} of {TOTAL}
                  {definition.optional ? " · optional" : ""}
                </p>
              )}
              <h2
                id="setup-step-title"
                ref={titleRef}
                tabIndex={-1}
                className="rounded-(--np-radius-tag) text-section font-semibold text-balance text-ink focus-halo outline-none"
              >
                {definition.title}
              </h2>
              <p className="max-w-[64ch] text-ui text-pretty text-ink-muted">
                {definition.description}
              </p>
            </div>

            <div className="flex min-w-0 flex-col gap-4 p-(--np-card-pad)">
              {resolved.redirected ? (
                <Alert variant="info" icon={<InfoIcon aria-hidden />}>
                  <AlertDescription>
                    {name} hasn’t reached “
                    {stepDefinition(resolved.redirected).label}” yet, so setup
                    opens at “{definition.label}”.
                  </AlertDescription>
                </Alert>
              ) : null}
              {showSummary ? (
                <ValidationSummary
                  title="Not ready to continue"
                  focusKey={attempt.key}
                  errors={[
                    {
                      fieldId: focusTargetFor(current),
                      message: attempt.message,
                    },
                  ]}
                />
              ) : null}
              <div
                id="setup-step-content"
                tabIndex={-1}
                className="flex min-w-0 flex-col gap-4 rounded-(--np-radius-card) outline-none"
              >
                <StepBody
                  step={current}
                  clientId={clientId}
                  clientName={name}
                  facts={facts}
                  connectionId={setup?.connection?.id ?? null}
                  onAgencyDirtyChange={setAgencyDirty}
                  onConnected={() => goTo("account")}
                />
              </div>
            </div>

            {isDone ? null : (
              <div
                data-slot="setup-footer"
                className="sticky bottom-0 z-10 mt-auto flex flex-wrap items-center gap-2 rounded-b-(--np-radius-card) border-t border-line bg-surface-alt px-(--np-card-pad) pt-3 pb-[max(12px,env(safe-area-inset-bottom))]"
              >
                <p
                  id="setup-continue-reason"
                  aria-live="polite"
                  className={cn(
                    "order-first w-full text-caption @min-[560px]/wiz:order-none @min-[560px]/wiz:w-auto @min-[560px]/wiz:flex-1 @min-[560px]/wiz:text-right",
                    blocker
                      ? "font-semibold text-warning-ink"
                      : "text-ink-muted"
                  )}
                >
                  {footerHint}
                </p>
                <Button
                  variant="ghost"
                  onClick={() => goTo(SETUP_STEPS[index - 1])}
                  disabled={index === 0}
                  className="@min-[560px]/wiz:order-first"
                >
                  <ArrowLeftIcon aria-hidden />
                  Back
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  {definition.optional ? (
                    <Button
                      variant="ghost"
                      onClick={() => goTo(SETUP_STEPS[index + 1])}
                    >
                      Skip for now
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => void advance()}
                    pending={checking}
                    pendingLabel="Checking…"
                    aria-describedby="setup-continue-reason"
                    data-blocked={blocker ? "" : undefined}
                  >
                    {importing ? "Continue while it runs" : "Continue"}
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  )
}

function WizardHeader({
  clientId,
  clientName,
}: {
  clientId: string
  clientName: string | undefined
}) {
  return (
    <PageHeader
      title="Client setup"
      eyebrow={clientName ? `Setting up ${clientName}` : "Setting up"}
      description="Each step is worked out from what already exists, so you can leave and pick this up later."
      actions={
        <Link
          href={`/clients/${clientId}`}
          className={cn(buttonVariants({ variant: "ghost" }))}
        >
          Finish later
        </Link>
      }
    />
  )
}

function WizardSkeleton() {
  return (
    <div className="@container/setup" role="status" aria-busy="true">
      <span className="sr-only">Loading this client’s setup</span>
      <div className="grid items-start gap-6 @min-[720px]/setup:grid-cols-[13.75rem_minmax(0,1fr)]">
        <div className="hidden flex-col gap-2 @min-[720px]/setup:flex">
          {SETUP_STEPS.map((step) => (
            <Skeleton key={step} className="h-8" />
          ))}
        </div>
        <div className="flex flex-col gap-3.5 rounded-(--np-radius-card) border border-line bg-surface p-(--np-card-pad)">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-6 w-56 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
          <Skeleton className="h-32 w-full rounded-(--np-radius-card)" />
        </div>
      </div>
    </div>
  )
}

function StepBody({
  step,
  clientId,
  clientName,
  facts,
  connectionId,
  onAgencyDirtyChange,
  onConnected,
}: {
  step: SetupStep
  clientId: string
  clientName: string
  facts: SetupFacts
  connectionId: string | null
  onAgencyDirtyChange: (dirty: boolean) => void
  onConnected: () => void
}) {
  switch (step) {
    case "agency":
      return <StepAgency onDirtyChange={onAgencyDirtyChange} />
    case "client":
      return <StepClientSummary clientId={clientId} clientName={clientName} />
    case "connect":
      return (
        <StepConnect
          clientId={clientId}
          clientName={clientName}
          onConnected={onConnected}
        />
      )
    case "account":
      return (
        <StepAccount
          clientName={clientName}
          clientId={clientId}
          connectionId={connectionId}
        />
      )
    case "locations":
      return <StepLocations clientId={clientId} clientName={clientName} />
    case "backfill":
      return <StepBackfill clientName={clientName} />
    case "notifications":
      return <StepNotifications />
    case "team":
      return <StepTeam clientName={clientName} />
    case "done":
      return (
        <StepDone clientId={clientId} clientName={clientName} facts={facts} />
      )
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
      <p className="text-body text-ink">
        You’re setting up{" "}
        <strong className="font-semibold">{clientName}</strong>.
      </p>
      <Link
        href={`/clients/${clientId}/settings`}
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
      >
        Rename or add notes in client settings
      </Link>
    </div>
  )
}

export { SetupWizard }
