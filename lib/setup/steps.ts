import type { WorkspaceMode } from "@/lib/contracts/session"
import {
  SETUP_STEPS,
  type ClientSetup,
  type SetupStep,
} from "@/lib/contracts/clients"

/**
 * The wizard's order and copy, in one place.
 *
 * Both the stepper the operator sees and the server's `nextStep` read from
 * here, so the rail cannot disagree with where the flow actually resumes.
 */
export type SetupStepDefinition = {
  id: SetupStep
  /** The short name in the stepper rail. */
  label: string
  title: string
  description: string
  /** Steps a client works without; the flow lets you move past them. */
  optional?: boolean
  /**
   * Done before the client's own flow starts (the agency exists, the client
   * was just created). Still reachable with Back or `?step=`, but left out of
   * the numbering and the rail, so a new client opens at "Step 1", not 3.
   */
  preamble?: boolean
}

export const SETUP_STEP_DEFINITIONS: SetupStepDefinition[] = [
  {
    id: "agency",
    label: "Agency",
    title: "Confirm your agency",
    description:
      "How your agency appears to your team, and the timezone reports and opening hours default to.",
    preamble: true,
  },
  {
    id: "client",
    label: "Client",
    title: "Confirm the client",
    description:
      "The business you look after, as you and your team refer to it.",
    preamble: true,
  },
  {
    id: "connect",
    label: "Connect",
    title: "Connect Google",
    description:
      "Which Google account manages this client's Business Profile? You can add another account later.",
  },
  {
    id: "account",
    label: "Account",
    title: "Choose the Business Profile accounts",
    description:
      "One Google login can manage several Business Profile accounts. Pick the ones that belong to this client.",
  },
  {
    id: "locations",
    label: "Listings",
    title: "Link this client's listings",
    description:
      "Reviews start flowing in for each listing as soon as it is linked.",
  },
  {
    id: "backfill",
    label: "Import reviews",
    title: "Import review history",
    description:
      "Bringing in past reviews so your reports and reply history are complete. You can carry on while this runs.",
  },
  {
    id: "notifications",
    label: "Notifications",
    title: "Real-time notifications",
    description:
      "Google can tell us the moment a review arrives, instead of waiting for the next scheduled check.",
    optional: true,
  },
  {
    id: "team",
    label: "Team",
    title: "Invite your team",
    description: "Who else works on this client's reviews?",
    optional: true,
  },
  {
    id: "done",
    label: "Done",
    title: "This client is set up",
    description: "Reviews are syncing. Here is where the work happens.",
  },
]

/**
 * The same flow in a business's words. A business has one home client that
 * exists from sign-up, so the `agency` step becomes "Business" (its name and
 * timezone) and the `client` step is gone: Business, Connect, Account,
 * Locations, Backfill, Notifications, Team. Business is the first numbered
 * step rather than a preamble, because it is the first thing the owner does.
 * No copy here may say "client" or "agency".
 */
const BUSINESS_OVERRIDES: Partial<
  Record<SetupStep, Partial<SetupStepDefinition>>
> = {
  agency: {
    label: "Business",
    title: "Confirm your business",
    description: "Your business name and timezone.",
    preamble: false,
  },
  connect: {
    description:
      "Which Google account manages your Business Profile? You can add another account later.",
  },
  account: {
    description:
      "One Google login can manage several Business Profile accounts. Pick the ones that belong to your business.",
  },
  locations: {
    title: "Link your listings",
    description:
      "Reviews start flowing in for each listing as soon as it is linked.",
  },
  team: { description: "Who else works on your reviews?" },
  done: {
    title: "You’re set up",
    description: "Reviews are syncing. Here is where the work happens.",
  },
}

const BUSINESS_DEFINITIONS: SetupStepDefinition[] =
  SETUP_STEP_DEFINITIONS.filter((step) => step.id !== "client").map((step) => ({
    ...step,
    ...BUSINESS_OVERRIDES[step.id],
  }))

/** The wizard's step definitions for a mode, in order. */
export function setupStepDefinitions(
  mode: WorkspaceMode = "agency"
): SetupStepDefinition[] {
  return mode === "business" ? BUSINESS_DEFINITIONS : SETUP_STEP_DEFINITIONS
}

/** The step ids a mode walks through, in order. */
export function setupStepsFor(mode: WorkspaceMode = "agency"): SetupStep[] {
  return setupStepDefinitions(mode).map((step) => step.id)
}

function definitionMap(mode: WorkspaceMode) {
  return new Map(setupStepDefinitions(mode).map((step) => [step.id, step]))
}

export function stepDefinition(
  id: SetupStep,
  mode: WorkspaceMode = "agency"
): SetupStepDefinition {
  return definitionMap(mode).get(id) ?? setupStepDefinitions(mode)[0]
}

export function stepIndex(id: SetupStep): number {
  return SETUP_STEPS.indexOf(id)
}

/** The steps that count: the flow's own, without the closing "Done". */
function numberedSteps(mode: WorkspaceMode): SetupStep[] {
  return setupStepDefinitions(mode)
    .filter((step) => !step.preamble && step.id !== "done")
    .map((step) => step.id)
}

/**
 * "Step N of M" for the flow's own steps, or null for a preamble step and
 * for Done, which the wizard shows without a number.
 */
export function stepNumber(
  id: SetupStep,
  mode: WorkspaceMode = "agency"
): { number: number; total: number } | null {
  const numbered = numberedSteps(mode)
  const position = numbered.indexOf(id)
  if (position === -1) return null
  return { number: position + 1, total: numbered.length }
}

export function isPreambleStep(
  id: SetupStep,
  mode: WorkspaceMode = "agency"
): boolean {
  return Boolean(definitionMap(mode).get(id)?.preamble)
}

export function isSetupStep(
  value: string | null | undefined
): value is SetupStep {
  return (
    typeof value === "string" &&
    (SETUP_STEPS as readonly string[]).includes(value)
  )
}

/** What the wizard knows: the derived setup, plus the org's own logins. */
export type SetupFacts = Pick<
  ClientSetup,
  | "connection"
  | "accountsActive"
  | "locationsLinked"
  | "backfill"
  | "notificationsEnabled"
  | "teamInvited"
> & {
  /**
   * The organisation holds at least one active Google login that does not
   * need reconnecting. The server only attributes a login to a client through
   * a linked listing, so a brand-new client reads as "not connected" even
   * when the agency's login is working — and the accounts and listings steps
   * are exactly where that link gets made.
   */
  usableLogin: boolean
}

/**
 * Connected for this client: a login attached to it. A working login
 * elsewhere in the organisation does not count on its own - the accounts
 * step saves against the client's login, so skipping the attach made every
 * save there fail with account_out_of_scope. `usableLogin` only changes what
 * the blocker asks for.
 */
function connected(facts: SetupFacts): boolean {
  return facts.connection?.status === "active"
}

/**
 * Whether the data says a step's work exists. Agency and client are done by
 * the time the wizard runs: the organisation and the client both exist.
 */
export function stepComplete(step: SetupStep, facts: SetupFacts): boolean {
  switch (step) {
    case "agency":
    case "client":
      return true
    case "connect":
      return connected(facts)
    case "account":
      return facts.accountsActive > 0
    case "locations":
      return facts.locationsLinked > 0
    case "backfill":
      return facts.backfill === "running" || facts.backfill === "done"
    case "notifications":
      return facts.notificationsEnabled
    case "team":
      return facts.teamInvited
    case "done":
      return false
  }
}

/**
 * Why Continue cannot move past `step` yet, in words, or null when it can.
 *
 * Optional steps never block: without real-time notifications reviews still
 * arrive on the scheduled sync, and a one-person agency has no one to invite.
 */
export function stepBlocker(step: SetupStep, facts: SetupFacts): string | null {
  switch (step) {
    case "connect":
      if (connected(facts)) return null
      return facts.usableLogin
        ? "Choose “Use this account”, or connect another Google account, to continue."
        : "Connect a Google account to continue."
    case "account":
      return facts.accountsActive > 0
        ? null
        : "Choose at least one Business Profile account to continue."
    case "locations":
      return facts.locationsLinked > 0
        ? null
        : "Link at least one listing to continue."
    case "backfill":
      if (facts.backfill === "failed")
        return "The review import stopped. Retry it to continue, or finish later."
      return facts.backfill === "not_started"
        ? "Start the review import to continue. It keeps running while you carry on."
        : null
    default:
      return null
  }
}

/**
 * The furthest step the operator may open: the first required step whose
 * work is missing, or the end when nothing blocks.
 */
export function furthestReachable(
  facts: SetupFacts,
  mode: WorkspaceMode = "agency"
): SetupStep {
  for (const step of setupStepsFor(mode)) {
    if (stepBlocker(step, facts)) return step
  }
  return "done"
}

/** Steps reachable now: everything up to and including `furthest`. */
export function canVisit(step: SetupStep, furthest: SetupStep): boolean {
  return stepIndex(step) <= stepIndex(furthest)
}

/**
 * Where the wizard opens. A requested step (the `?step=` deep link) wins when
 * it is reachable; otherwise the server's resume point, never beyond what is
 * reachable. `redirected` says a requested step was refused, so the page can
 * say why rather than silently showing a different step.
 */
export function resolveStep(
  requested: string | null | undefined,
  resume: SetupStep,
  facts: SetupFacts,
  mode: WorkspaceMode = "agency"
): { step: SetupStep; redirected: SetupStep | null } {
  const steps = setupStepsFor(mode)
  const furthest = furthestReachable(facts, mode)
  const landing =
    steps.includes(resume) && canVisit(resume, furthest) ? resume : furthest
  // A step this mode does not have (`client` for a business) is not a
  // destination: it lands like an unknown value rather than being "refused".
  if (!isSetupStep(requested) || !steps.includes(requested))
    return { step: landing, redirected: null }
  if (canVisit(requested, furthest))
    return { step: requested, redirected: null }
  return { step: landing, redirected: requested }
}

/**
 * The steps for the rail: done when its work exists, current where the
 * operator is, to-do otherwise; `reachable` decides whether it is a link.
 * Stepping back to re-read an answer keeps later work marked done.
 *
 * Preamble steps (agency, client) are left out unless the operator is on
 * one, so the rail is the client's own flow and still marks where they are.
 */
export function stepperState(
  current: SetupStep,
  facts: SetupFacts,
  mode: WorkspaceMode = "agency"
): {
  id: SetupStep
  label: string
  optional: boolean
  reachable: boolean
  state: "done" | "current" | "todo"
}[] {
  const furthest = furthestReachable(facts, mode)
  const onPreamble = isPreambleStep(current, mode)
  return setupStepDefinitions(mode)
    .filter((step) => onPreamble || !step.preamble)
    .map((step) => ({
      id: step.id,
      label: step.label,
      optional: Boolean(step.optional),
      reachable: canVisit(step.id, furthest),
      state:
        step.id === current
          ? "current"
          : stepComplete(step.id, facts)
            ? "done"
            : "todo",
    }))
}
