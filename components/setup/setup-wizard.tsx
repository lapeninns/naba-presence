"use client"

import {
  ArrowLeftIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  InfoIcon,
} from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import * as React from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import { ActionBar } from "@/components/ui/action-bar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { cardClassName } from "@/components/ui/card"
import { Empty } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Stepper } from "@/components/ui/stepper"
import { ValidationSummary } from "@/components/ui/validation-summary"
import type { SetupStep } from "@/lib/contracts/clients"
import { useKeepFocusClear } from "@/lib/editors/use-keep-focus-clear"
import { describeActionError } from "@/lib/errors/action-errors"
import { useClient, useClientSetup } from "@/lib/queries/use-clients"
import { useConnectionWorkspace } from "@/lib/queries/use-connection-workspace"
import { GOOGLE_RETURN_PARAMS } from "@/lib/setup/oauth-status"
import {
  resolveStep,
  setupStepsFor,
  stepBlocker,
  stepDefinition,
  stepNumber,
  stepperState,
  type SetupFacts,
} from "@/lib/setup/steps"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"

// Each step is its own chunk: an operator sees one at a time, and the
// locations step (the onboarding drafts) alone is most of the wizard's code.
// The step after the current one is preloaded, so Continue does not wait.
const STEP_LOADERS: Partial<Record<SetupStep, () => Promise<unknown>>> = {
  agency: () => import("./step-agency"),
  connect: () => import("./step-connect"),
  account: () => import("./step-account"),
  locations: () => import("./step-locations"),
  backfill: () => import("./step-backfill"),
  notifications: () => import("./step-notifications"),
  team: () => import("./step-team"),
  done: () => import("./step-done"),
}
const StepAgency = dynamic(() =>
  import("./step-agency").then((m) => m.StepAgency)
)
const StepConnect = dynamic(() =>
  import("./step-connect").then((m) => m.StepConnect)
)
const StepAccount = dynamic(() =>
  import("./step-account").then((m) => m.StepAccount)
)
const StepLocations = dynamic(() =>
  import("./step-locations").then((m) => m.StepLocations)
)
const StepBackfill = dynamic(() =>
  import("./step-backfill").then((m) => m.StepBackfill)
)
const StepNotifications = dynamic(() =>
  import("./step-notifications").then((m) => m.StepNotifications)
)
const StepTeam = dynamic(() => import("./step-team").then((m) => m.StepTeam))
const StepDone = dynamic(() => import("./step-done").then((m) => m.StepDone))

const AGENCY_UNSAVED =
  "Save the new timezone, or change it back, before continuing."

/**
 * Below md the step is a focused screen rather than a card (Notion Mail's
 * onboarding): no border, radius or white slab, just the step on the page
 * ground with the page's own gutter. From md it is the card beside the rail.
 */
const PHONE_UNCARDED =
  "max-md:rounded-none max-md:border-0 max-md:bg-transparent"

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
 * from 48rem of room; below that the rail folds into "Step N of 6" with a
 * progress bar and an "All steps" disclosure. The card's footer (Back, the
 * reason Continue is blocked, Continue) is a docked ActionBar: fixed to the
 * bottom of the screen on a phone so it is always reachable, sticky at the
 * foot of the card from md.
 */
function SetupWizard({ clientId }: { clientId: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const mode = useWorkspaceMode()
  const business = mode === "business"
  const flow = setupStepsFor(mode)
  const setupQuery = useClientSetup(clientId)
  const clientQuery = useClient(clientId)
  const { query: connectionsQuery } = useConnectionWorkspace()

  const [agencyDirty, setAgencyDirty] = React.useState(false)
  const [onboardingDirty, setOnboardingDirty] = React.useState(false)
  const saveBeforeContinue = React.useRef<(() => Promise<boolean>) | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [attempt, setAttempt] = React.useState<{
    step: SetupStep
    message: string
    key: number
  } | null>(null)
  const [stepsOpen, setStepsOpen] = React.useState(false)
  const titleRef = React.useRef<HTMLHeadingElement>(null)
  // Keyboard safety for the docked step bar, as the editors have it: a
  // focused field (or one under a just-opened phone keyboard) is scrolled
  // clear of the bar's measured top, which is two rows when a blocked
  // step's reason sits over Back and Continue. The section mounts after the
  // loading states, so the hook follows it through a callback ref.
  const [stepSection, setStepSection] = React.useState<HTMLElement | null>(null)
  const stepSectionRef = React.useMemo(
    () => ({ current: stepSection }),
    [stepSection]
  )
  useKeepFocusClear(stepSectionRef, "[data-slot=setup-footer]")

  const clientName = clientQuery.data?.client.name
  const setup = setupQuery.data?.setup
  const usableLogin = (connectionsQuery.data?.connections ?? []).some(
    (connection) =>
      connection.status === "active" && !connection.reconnectRequired
  )
  const facts: SetupFacts | null = setup ? { ...setup, usableLogin } : null
  const resolved = facts
    ? resolveStep(params.get("step"), setup!.nextStep, facts, mode)
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

  const following = flow[flow.indexOf(current) + 1]
  React.useEffect(() => {
    if (following) void STEP_LOADERS[following]?.()
  }, [following])

  const hrefFor = (step: SetupStep) => {
    const next = new URLSearchParams(params.toString())
    for (const key of GOOGLE_RETURN_PARAMS) next.delete(key)
    next.set("step", step)
    return `/setup?${next}`
  }
  const goTo = (step: SetupStep) => {
    if (current === "locations" && onboardingDirty) {
      setAttempt({
        step: current,
        message:
          "Save your business draft before changing setup steps, or use Saved drafts to discard your edits.",
        key: Date.now(),
      })
      return
    }
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
        <WizardHeader
          clientId={clientId}
          clientName={clientName}
          business={business}
        />
        <div className={cardClassName({ className: PHONE_UNCARDED })}>
          <Empty
            tone="bad"
            titleAs="h2"
            icon={<CircleAlertIcon />}
            title={
              business
                ? "We couldn’t load your setup"
                : "We couldn’t load this client’s setup"
            }
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
        <WizardHeader
          clientId={clientId}
          clientName={clientName}
          business={business}
        />
        <WizardSkeleton business={business} flow={flow} />
      </>
    )
  }

  const definition = stepDefinition(current, mode)
  const index = flow.indexOf(current)
  const numbered = stepNumber(current, mode)
  const isDone = current === "done"
  const blocker =
    current === "agency" && agencyDirty
      ? AGENCY_UNSAVED
      : stepBlocker(current, facts)
  const showSummary = attempt?.step === current
  const steps = stepperState(current, facts, mode).map((step) => ({
    id: step.id,
    label: step.label,
    state: step.state,
    note: step.optional ? "Optional" : undefined,
    href: step.reachable && step.id !== current ? hrefFor(step.id) : undefined,
  }))
  const name = business
    ? (clientName ?? "your business")
    : (clientName ?? "this client")
  const importing = current === "backfill" && facts.backfill === "running"

  const advance = async () => {
    if (current === "locations" && onboardingDirty) {
      setAttempt({
        step: current,
        message:
          "Save your business draft before continuing, or use Saved drafts to discard your edits.",
        key: Date.now(),
      })
      return
    }
    setChecking(true)
    // A step with unsaved work (the accounts picker) saves it first; a save
    // that fails shows its reason inline in the step and Continue stays put.
    const saveFirst = saveBeforeContinue.current
    if (saveFirst && !(await saveFirst())) {
      setChecking(false)
      return
    }
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
    goTo(flow[Math.min(index + 1, flow.length - 1)])
  }

  const footerHint = blocker
    ? blocker
    : definition.optional
      ? "Optional. You can skip this and come back later."
      : "You can come back to any step later."

  return (
    <>
      <WizardHeader
        clientId={clientId}
        clientName={clientName}
        business={business}
      />

      <div className="@container/setup">
        <div className="grid items-start gap-6 @3xl/setup:grid-cols-[13.75rem_minmax(0,1fr)]">
          <nav
            aria-label="Setup progress"
            className="sticky top-(--np-toolbar-h) -mt-4 hidden flex-col gap-3 pt-4 @3xl/setup:flex"
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
            ref={setStepSection}
            aria-labelledby="setup-step-title"
            data-step={current}
            className={cardClassName({
              className: cn(
                "@container/wiz flex min-w-0 flex-col",
                PHONE_UNCARDED
              ),
            })}
          >
            <div className="flex flex-col gap-1 border-b border-line-subtle px-(--np-card-pad) pt-(--np-card-pad) pb-4 max-md:px-0 max-md:pt-0">
              <div className="mb-2 flex flex-col gap-2 @3xl/setup:hidden">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-caption font-semibold text-ink">
                    {numbered
                      ? `Step ${numbered.number} of ${numbered.total} · ${definition.label}`
                      : isDone
                        ? definition.label
                        : `Before you start · ${definition.label}`}
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
                {numbered ? (
                  <Progress
                    value={numbered.number}
                    max={numbered.total}
                    label={`Setup progress: step ${numbered.number} of ${numbered.total}`}
                  />
                ) : null}
                <div id="setup-all-steps" hidden={!stepsOpen}>
                  {stepsOpen ? (
                    <Stepper
                      orientation="vertical"
                      aria-label="Setup steps"
                      steps={steps}
                      className="mt-2 rounded-(--np-radius-card) border border-line-subtle bg-surface-alt p-1.5"
                    />
                  ) : null}
                </div>
              </div>
              {isDone ? null : (
                <p className="hidden text-caption font-semibold text-ink-secondary @3xl/setup:block">
                  {numbered
                    ? `Step ${numbered.number} of ${numbered.total}`
                    : "Before you start"}
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
              <p className="max-w-(--np-measure-reading) text-body text-pretty text-ink-muted">
                {definition.description}
              </p>
            </div>

            <div className="flex min-w-0 flex-col gap-4 p-(--np-card-pad) max-md:px-0">
              {resolved.redirected ? (
                <Alert variant="info" icon={<InfoIcon aria-hidden />}>
                  <AlertDescription>
                    {business ? "Setup" : name} hasn’t reached “
                    {stepDefinition(resolved.redirected, mode).label}” yet, so
                    setup opens at “{definition.label}”.
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
                  business={business}
                  facts={facts}
                  connectionId={setup?.connection?.id ?? null}
                  onAgencyDirtyChange={setAgencyDirty}
                  onOnboardingDirtyChange={setOnboardingDirty}
                  saveBeforeContinueRef={saveBeforeContinue}
                  onConnected={() => goTo("account")}
                />
              </div>
            </div>

            {/* The step's actions: the shared ActionBar, docked. On a phone
                it is fixed to the bottom edge (the tab bar steps aside, the
                page's scroll padding follows it, and it rides the on-screen
                keyboard); from md it sticks to the foot of the card. The
                surface tone: these move between steps, nothing here reaches
                Google. Laid out as the card's last row (its gutter, its
                corners), the buttons in one row; a blocked step's reason
                takes a row of its own above them on a narrow card.

                Except on a short phone (under 640px tall): there two rows
                with the app bar took over a quarter of the screen, so the
                bar keeps the ActionBar's docked one-line shape instead.
                Back shrinks to its arrow (still named "Back", still 44px)
                and the reason, whole and readable, sits between it and
                Continue; the gaps and the reason's weight ease so the
                longest reason fits in five lines at 320px. */}
            <ActionBar
              data-slot="setup-footer"
              label="Step actions"
              tone="surface"
              dock
              visible={!isDone}
              className="mt-auto gap-2 rounded-none rounded-b-(--np-radius-card) border-x-0 border-b-0 bg-surface-alt px-(--np-card-pad) pt-3 shadow-none max-md:flex-wrap max-md:short:gap-1.5"
            >
              {/* One row of buttons. The reason line shows only when it
                    says why Continue is blocked; otherwise it stays for
                    assistive tech (Continue's description, and the live
                    region that announces a blocker), since the rail and the
                    step header already say the step can be revisited. */}
              <p
                id="setup-continue-reason"
                aria-live="polite"
                className={cn(
                  blocker
                    ? "order-first w-full text-caption font-semibold text-warning-ink @min-[560px]/wiz:order-none @min-[560px]/wiz:w-auto @min-[560px]/wiz:flex-1 @min-[560px]/wiz:text-right max-md:short:order-none max-md:short:w-auto max-md:short:min-w-0 max-md:short:flex-1 max-md:short:leading-tight max-md:short:font-medium"
                    : "sr-only"
                )}
              >
                {footerHint}
              </p>
              <Button
                variant="ghost"
                onClick={() => goTo(flow[index - 1])}
                disabled={index === 0}
                className="@min-[560px]/wiz:order-first max-md:short:order-first max-md:short:min-w-11 max-md:short:px-0"
              >
                <ArrowLeftIcon aria-hidden />
                <span className="max-md:short:sr-only">Back</span>
              </Button>
              <div className="ml-auto flex items-center gap-2 max-md:short:gap-1.5">
                {definition.optional ? (
                  <Button variant="ghost" onClick={() => goTo(flow[index + 1])}>
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
            </ActionBar>
          </section>
        </div>
      </div>
    </>
  )
}

function WizardHeader({
  clientId,
  clientName,
  business,
}: {
  clientId: string
  clientName: string | undefined
  business: boolean
}) {
  return (
    <PageHeader
      title={business ? "Setup" : "Client setup"}
      eyebrow={clientName ? `Setting up ${clientName}` : "Setting up"}
      description="Each step is worked out from what already exists, so you can leave and pick this up later."
      // "Finish later" sits on the title row, compact, rather than in
      // `actions`, which a phone stretches to a full-width row of its own
      // above the step.
      meta={
        <Link
          href={business ? "/listings" : `/clients/${clientId}`}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "-mr-2 ml-auto"
          )}
        >
          Finish later
        </Link>
      }
    />
  )
}

function WizardSkeleton({
  business,
  flow,
}: {
  business: boolean
  flow: SetupStep[]
}) {
  return (
    <div className="@container/setup" role="status" aria-busy="true">
      <span className="sr-only">
        {business ? "Loading your setup" : "Loading this client’s setup"}
      </span>
      <div className="grid items-start gap-6 @3xl/setup:grid-cols-[13.75rem_minmax(0,1fr)]">
        <div className="hidden flex-col gap-2 @3xl/setup:flex">
          {flow.map((step) => (
            <Skeleton key={step} className="h-8" />
          ))}
        </div>
        <div
          className={cardClassName({
            pad: true,
            className: cn("flex flex-col gap-4", PHONE_UNCARDED, "max-md:p-0"),
          })}
        >
          <div className="flex flex-col gap-2 border-b border-line-subtle pb-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-6 w-56 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
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
  business,
  facts,
  connectionId,
  onAgencyDirtyChange,
  onOnboardingDirtyChange,
  saveBeforeContinueRef,
  onConnected,
}: {
  step: SetupStep
  clientId: string
  clientName: string
  business: boolean
  facts: SetupFacts
  connectionId: string | null
  onAgencyDirtyChange: (dirty: boolean) => void
  onOnboardingDirtyChange: (dirty: boolean) => void
  saveBeforeContinueRef: React.RefObject<(() => Promise<boolean>) | null>
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
          business={business}
          onConnected={onConnected}
        />
      )
    case "account":
      return (
        <StepAccount
          clientName={clientName}
          business={business}
          clientId={clientId}
          connectionId={connectionId}
          saveBeforeContinueRef={saveBeforeContinueRef}
        />
      )
    case "locations":
      return (
        <StepLocations
          clientId={clientId}
          clientName={clientName}
          business={business}
          connectionId={connectionId}
          onDirtyChange={onOnboardingDirtyChange}
        />
      )
    case "backfill":
      return (
        <StepBackfill
          clientId={clientId}
          clientName={clientName}
          business={business}
        />
      )
    case "notifications":
      return <StepNotifications />
    case "team":
      return <StepTeam clientName={clientName} business={business} />
    case "done":
      return (
        <StepDone
          clientId={clientId}
          clientName={clientName}
          business={business}
          facts={facts}
        />
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
