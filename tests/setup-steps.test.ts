import { describe, expect, it } from "vitest"

import { nextIncompleteStep } from "@/lib/contracts/clients"
import { canVisit, stepperState, stepIndex } from "@/lib/setup/steps"

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
    expect(nextIncompleteStep({ ...base, locationsLinked: 0 })).toBe("locations")
    expect(nextIncompleteStep({ ...base, backfill: "not_started" })).toBe("backfill")
    expect(nextIncompleteStep({ ...base, notificationsEnabled: false })).toBe("notifications")
    expect(nextIncompleteStep({ ...base, teamInvited: false })).toBe("team")
    expect(nextIncompleteStep(base)).toBe("done")
  })

  it("sends a broken connection back to the connect step", () => {
    // A step undone elsewhere correctly moves the flow backwards: a client
    // whose Google login expired is not "connected" just because it once was.
    expect(
      nextIncompleteStep({ ...base, connection: { id: "gc1", status: "expired" } })
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

describe("stepperState", () => {
  it("keeps earlier work marked done when the operator steps back", () => {
    // Stepping back to re-read an answer must not look like the work was
    // undone.
    const state = stepperState("client", "locations")
    const byId = Object.fromEntries(state.map((s) => [s.id, s.state]))
    expect(byId.agency).toBe("done")
    expect(byId.client).toBe("current")
    expect(byId.connect).toBe("done")
    expect(byId.locations).toBe("todo")
  })

  it("omits the terminal step from the rail", () => {
    expect(stepperState("agency", "agency").some((s) => s.id === "done")).toBe(false)
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
