import { SETUP_STEPS, type SetupStep } from "@/lib/contracts/clients"

/**
 * The wizard's order and copy, in one place.
 *
 * Both the stepper the operator sees and the server's `nextStep` read from
 * here, so the sidebar cannot disagree with where the flow actually resumes.
 */
export type SetupStepDefinition = {
  id: SetupStep
  label: string
  title: string
  description: string
  /** Steps a client works without; the flow lets you move past them. */
  optional?: boolean
}

export const SETUP_STEP_DEFINITIONS: SetupStepDefinition[] = [
  {
    id: "agency",
    label: "Agency",
    title: "Confirm your agency",
    description:
      "How your agency appears to your team, and the timezone reports and opening hours default to.",
  },
  {
    id: "client",
    label: "Client",
    title: "Name the client",
    description: "The business you look after, as you and your team refer to it.",
  },
  {
    id: "connect",
    label: "Connect Google",
    title: "Connect Google",
    description:
      "Which Google account manages this client's Business Profile? You can add another account later.",
  },
  {
    id: "account",
    label: "Choose accounts",
    title: "Choose the Business Profile accounts",
    description:
      "One Google login can manage several Business Profile accounts. Pick the ones that belong to this client.",
  },
  {
    id: "locations",
    label: "Link locations",
    title: "Link this client's locations",
    description:
      "Reviews start flowing in for each location as soon as it is linked.",
  },
  {
    id: "backfill",
    label: "Import history",
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
    label: "Invite team",
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

const BY_ID = new Map(SETUP_STEP_DEFINITIONS.map((step) => [step.id, step]))

export function stepDefinition(id: SetupStep): SetupStepDefinition {
  return BY_ID.get(id) ?? SETUP_STEP_DEFINITIONS[0]
}

export function stepIndex(id: SetupStep): number {
  return SETUP_STEPS.indexOf(id)
}

/**
 * Which steps the stepper shows as done, current and still to come.
 *
 * `current` is where the operator IS, `furthest` is how far the data says they
 * have actually got. They differ whenever someone steps back to re-read an
 * earlier answer, and a stepper that greyed those out would suggest the work
 * had been undone.
 */
export function stepperState(
  current: SetupStep,
  furthest: SetupStep
): { id: SetupStep; label: string; state: "done" | "current" | "todo" }[] {
  const currentIndex = stepIndex(current)
  const furthestIndex = stepIndex(furthest)
  return SETUP_STEP_DEFINITIONS.filter((step) => step.id !== "done").map(
    (step) => {
      const index = stepIndex(step.id)
      return {
        id: step.id,
        label: step.label,
        state:
          index === currentIndex
            ? "current"
            : index < furthestIndex
              ? "done"
              : "todo",
      }
    }
  )
}

/** Steps reachable now: everything up to and including where the data has got. */
export function canVisit(step: SetupStep, furthest: SetupStep): boolean {
  return stepIndex(step) <= stepIndex(furthest)
}
