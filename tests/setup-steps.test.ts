import { describe, expect, it } from "vitest"

import { nextIncompleteStep } from "@/lib/contracts/clients"
import {
  canVisit,
  furthestReachable,
  resolveStep,
  setupStepDefinitions,
  setupStepsFor,
  stepBlocker,
  stepDefinition,
  stepIndex,
  stepNumber,
  stepperState,
} from "@/lib/setup/steps"

const base = {
  connection: { id: "gc1", status: "active" as const },
  accountsActive: 1,
  locationsLinked: 2,
  backfill: "done" as const,
  notificationsEnabled: true,
  teamInvited: true,
}

describe("nextIncompleteStep", () => {
  it("resumes at the first thing that is not done", () => {
    // Nothing is stored about the operator's progress; every answer comes from
    // data that had to exist anyway, so closing the tab and coming back
    // tomorrow lands in the same place.
    expect(nextIncompleteStep({ ...base, connection: null })).toBe("connect")
    expect(nextIncompleteStep({ ...base, accountsActive: 0 })).toBe("account")
    expect(nextIncompleteStep({ ...base, locationsLinked: 0 })).toBe(
      "locations"
    )
    expect(nextIncompleteStep({ ...base, backfill: "not_started" })).toBe(
      "backfill"
    )
    expect(nextIncompleteStep({ ...base, notificationsEnabled: false })).toBe(
      "notifications"
    )
    expect(nextIncompleteStep({ ...base, teamInvited: false })).toBe("team")
    expect(nextIncompleteStep(base)).toBe("done")
  })

  it("sends a broken connection back to the connect step", () => {
    // A step undone elsewhere correctly moves the flow backwards: a client
    // whose Google login expired is not "connected" just because it once was.
    expect(
      nextIncompleteStep({
        ...base,
        connection: { id: "gc1", status: "expired" },
      })
    ).toBe("connect")
  })

  it("treats a failed import as unfinished", () => {
    expect(nextIncompleteStep({ ...base, backfill: "failed" })).toBe("backfill")
    // Running is not a reason to hold the operator up: the flow moves on to
    // the next unfinished step while the import continues behind it.
    expect(
      nextIncompleteStep({
        ...base,
        backfill: "running",
        notificationsEnabled: false,
      })
    ).toBe("notifications")
  })
})

const facts = {
  connection: null,
  accountsActive: 0,
  locationsLinked: 0,
  backfill: "not_started" as const,
  notificationsEnabled: false,
  teamInvited: false,
  usableLogin: false,
}

describe("stepperState", () => {
  it("keeps earlier work marked done when the operator steps back", () => {
    // Stepping back to re-read an answer must not look like the work was
    // undone.
    const state = stepperState("client", {
      ...facts,
      connection: base.connection,
      accountsActive: 1,
    })
    const byId = Object.fromEntries(state.map((s) => [s.id, s.state]))
    expect(byId.agency).toBe("done")
    expect(byId.client).toBe("current")
    expect(byId.connect).toBe("done")
    expect(byId.account).toBe("done")
    expect(byId.locations).toBe("todo")
  })

  it("shows the client's own steps, and links only the reachable ones", () => {
    const state = stepperState("connect", facts)
    // Agency and client are done before the flow starts, so a new client's
    // rail begins at Connect.
    expect(state.map((s) => s.id)).toEqual([
      "connect",
      "account",
      "locations",
      "backfill",
      "notifications",
      "team",
      "done",
    ])
    const reachable = state.filter((s) => s.reachable).map((s) => s.id)
    expect(reachable).toEqual(["connect"])
  })

  it("keeps the preamble steps in the rail while the operator is on one", () => {
    const state = stepperState("agency", facts)
    expect(state[0]?.id).toBe("agency")
    expect(state).toHaveLength(9)
  })
})

describe("stepNumber", () => {
  it("numbers only the client's own steps", () => {
    expect(stepNumber("connect")).toEqual({ number: 1, total: 6 })
    expect(stepNumber("team")).toEqual({ number: 6, total: 6 })
    expect(stepNumber("agency")).toBeNull()
    expect(stepNumber("client")).toBeNull()
    expect(stepNumber("done")).toBeNull()
  })
})

describe("furthestReachable", () => {
  it("stops at the first required step whose work is missing", () => {
    expect(furthestReachable(facts)).toBe("connect")
    const attached = {
      ...facts,
      connection: { id: "c1", status: "active" as const },
    }
    expect(furthestReachable(attached)).toBe("account")
    expect(furthestReachable({ ...attached, accountsActive: 1 })).toBe(
      "locations"
    )
    expect(
      furthestReachable({
        ...facts,
        ...base,
        backfill: "not_started",
        usableLogin: false,
      })
    ).toBe("backfill")
  })

  it("never blocks on the optional steps", () => {
    // Without real-time notifications reviews still arrive on the scheduled
    // sync, and a one-person agency has no one to invite.
    expect(
      furthestReachable({
        ...base,
        backfill: "running",
        notificationsEnabled: false,
        teamInvited: false,
        usableLogin: false,
      })
    ).toBe("done")
  })

  it("asks for the agency login to be attached rather than skipping past it", () => {
    // The accounts step saves against the client's own login, so an
    // unattached agency login left every save there out of scope.
    expect(stepBlocker("connect", { ...facts, usableLogin: true })).toMatch(
      /Use this account/
    )
    expect(stepBlocker("connect", facts)).toMatch(/Connect a Google account/)
    expect(
      stepBlocker("connect", {
        ...facts,
        connection: { id: "c1", status: "active" },
      })
    ).toBeNull()
  })

  it("treats a failed import as blocking, with a way forward", () => {
    expect(stepBlocker("backfill", { ...facts, backfill: "failed" })).toMatch(
      /Retry it/
    )
    expect(
      stepBlocker("backfill", { ...facts, backfill: "running" })
    ).toBeNull()
  })
})

describe("resolveStep", () => {
  it("honours a reachable ?step= deep link", () => {
    expect(resolveStep("agency", "connect", facts)).toEqual({
      step: "agency",
      redirected: null,
    })
  })

  it("falls back to the resume step, and says which step was refused", () => {
    expect(resolveStep("done", "connect", facts)).toEqual({
      step: "connect",
      redirected: "done",
    })
  })

  it("ignores an unknown step name", () => {
    expect(resolveStep("nonsense", "connect", facts)).toEqual({
      step: "connect",
      redirected: null,
    })
  })
})

describe("canVisit", () => {
  it("allows revisiting completed steps but not skipping ahead", () => {
    expect(canVisit("agency", "locations")).toBe(true)
    expect(canVisit("locations", "locations")).toBe(true)
    expect(canVisit("notifications", "locations")).toBe(false)
  })
})

describe("stepIndex", () => {
  it("orders the flow", () => {
    expect(stepIndex("agency")).toBeLessThan(stepIndex("connect"))
    expect(stepIndex("connect")).toBeLessThan(stepIndex("done"))
  })
})

describe("business-mode setup flow", () => {
  const ready = { ...facts, usableLogin: true }
  const businessSteps = [
    "agency",
    "connect",
    "account",
    "locations",
    "backfill",
    "notifications",
    "team",
    "done",
  ]

  it("walks Business, Connect, Account, Locations, Backfill, Notifications, Team", () => {
    expect(setupStepsFor("business")).toEqual(businessSteps)
    // The agency flow is unchanged and keeps its client step.
    expect(setupStepsFor("agency")).toContain("client")
    expect(setupStepsFor()).toEqual(setupStepsFor("agency"))
  })

  it("turns the agency step into Business and numbers it as step 1", () => {
    const business = stepDefinition("agency", "business")
    expect(business.label).toBe("Business")
    expect(business.description).toBe("Your business name and timezone.")
    expect(stepNumber("agency", "business")).toEqual({ number: 1, total: 7 })
    expect(stepNumber("connect", "business")).toEqual({ number: 2, total: 7 })
    expect(stepNumber("done", "business")).toBeNull()
    // In an agency it is still a preamble, outside the numbering.
    expect(stepNumber("agency")).toBeNull()
    expect(stepNumber("connect")).toEqual({ number: 1, total: 6 })
  })

  it("never uses the words client or agency in a business's copy", () => {
    const words = setupStepDefinitions("business")
      .map((step) => `${step.label} ${step.title} ${step.description}`)
      .join(" ")
    expect(words).not.toMatch(/client|agency/i)
  })

  it("leaves the client step out of the rail and treats it as unknown", () => {
    const rail = stepperState("connect", ready, "business").map((s) => s.id)
    expect(rail).toEqual(businessSteps)
    // A stale `?step=client` link lands where the data is, without the
    // "hasn't reached" note.
    expect(resolveStep("client", "connect", ready, "business")).toEqual({
      step: "connect",
      redirected: null,
    })
  })

  it("still holds the owner at the first unmet step", () => {
    expect(furthestReachable(ready, "business")).toBe("connect")
    expect(resolveStep("team", "connect", ready, "business")).toEqual({
      step: "connect",
      redirected: "team",
    })
  })
})

import { describeGoogleConnectStatus } from "@/lib/setup/oauth-status"

describe("describeGoogleConnectStatus wording", () => {
  it("says business, not agency, in business mode", () => {
    expect(describeGoogleConnectStatus("403", null, "business")).toMatch(
      /this business/
    )
    expect(describeGoogleConnectStatus("403", null, "business")).not.toMatch(
      /agency|client/i
    )
    expect(describeGoogleConnectStatus("403")).toMatch(/this agency/)
  })
})
