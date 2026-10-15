import { describe, expect, it } from "vitest"

import {
  combinedReviewNote,
  combinedRowResults,
  type CombinedReviewRow,
} from "@/components/reviewed-write/combined-review"
import type { PublishStepResult } from "@/lib/editors/use-publish-flow"

const here = (field: string, noun?: string): CombinedReviewRow => ({
  key: `profile-${field}`,
  field,
  noun,
  before: "a",
  after: "b",
  route: "here",
  steps: ["save", "profile"],
})
const google = (field: string, waits = false, step = "listing"): CombinedReviewRow => ({
  key: `${step}-${field}`,
  field,
  before: "a",
  after: "b",
  route: "google",
  steps: [step],
  waitsForApprover: waits,
})

describe("combinedReviewNote", () => {
  it("says which changes save here first and which go to Google, from what is in the sheet", () => {
    expect(
      combinedReviewNote([
        here("Business name", "name"),
        here("Phone", "phone"),
        google("Primary category"),
      ])
    ).toBe("Name and phone save here first; primary category goes to Google when you publish.")
  })

  it("covers a sheet of one kind only", () => {
    expect(combinedReviewNote([here("Business name", "name")])).toBe(
      "Name saves here first, then goes to Google when you publish."
    )
    expect(combinedReviewNote([google("Store code"), google("Labels")])).toBe(
      "Store code and labels go to Google when you publish."
    )
    expect(combinedReviewNote([])).toBeNull()
  })

  it("keeps a label's own capitals and shortens a long list", () => {
    expect(
      combinedReviewNote([
        google("Wi-Fi", false, "attributes"),
        google("Store code"),
        google("Labels"),
        google("Locality"),
        google("Postcode"),
      ])
    ).toBe("Wi-Fi, store code, labels and 2 more go to Google when you publish.")
  })

  it("names a request that waits for another publisher, never as sent", () => {
    const note = combinedReviewNote([here("Business name", "name"), google("Store code", true)])
    expect(note).toBe(
      "Name saves here first; store code waits for another publisher to approve before it goes to Google."
    )
    expect(note).not.toMatch(/straight|No draft|reviewed, then/)
  })
})

const step = (key: string, extra: Partial<PublishStepResult>): PublishStepResult => ({
  key,
  label: key,
  status: "pending",
  kind: key === "save" ? "local" : "google",
  verified: true,
  ...extra,
})

describe("combinedRowResults", () => {
  const rows = [here("Business name", "name"), google("Store code"), google("Wi-Fi", false, "attributes")]

  it("shows nothing before publishing", () => {
    expect(combinedRowResults(rows, [])).toEqual([])
  })

  it("gives each row the outcome of the steps that carry it", () => {
    const views = combinedRowResults(rows, [
      step("listing", { status: "done" }),
      step("save", { status: "done" }),
      step("profile", { status: "done" }),
      step("attributes", { status: "failed", outcome: "rejected", message: "Google refused it.", code: "PERMISSION_DENIED" }),
    ])
    expect(views.map((view) => [view.label, view.state])).toEqual([
      ["Business name", "confirmed_applied"],
      ["Store code", "confirmed_applied"],
      ["Wi-Fi", "rejected"],
    ])
    expect(views[2]?.errorCode).toBe("PERMISSION_DENIED")
  })

  it("says a saved-here row stopped short of Google when its publish never ran", () => {
    const views = combinedRowResults(rows, [
      step("listing", { status: "failed", outcome: "failed", message: "Couldn't send." }),
      step("save", {}),
      step("profile", {}),
      step("attributes", {}),
    ])
    expect(views[0]).toMatchObject({ state: "skipped", stateLabel: "Not sent — an earlier step failed" })
    expect(views[1]).toMatchObject({ state: "failed" })

    const later = combinedRowResults(rows, [
      step("listing", { status: "done" }),
      step("save", { status: "done" }),
      step("profile", { status: "failed", outcome: "failed", message: "Couldn't send." }),
      step("attributes", {}),
    ])
    expect(later[0]).toMatchObject({ state: "failed", detail: "Saved here. Couldn't send." })
    expect(later[2]).toMatchObject({ state: "skipped" })
  })

  it("shows a waiting request as awaiting approval with its reason, not sent", () => {
    const views = combinedRowResults([google("Store code", true)], [
      step("listing", {
        status: "done",
        outcome: "awaiting_approval",
        message: "Sent for approval. Another publisher needs to approve this change before it goes to Google.",
      }),
    ])
    expect(views[0]).toMatchObject({ state: "awaiting_approval" })
    expect(String(views[0]?.detail)).toMatch(/Another publisher needs to approve/)
  })

  it("adds a step that carries no row only when it did something or failed", () => {
    const quiet = combinedRowResults([google("Store code")], [
      step("listing", { status: "done" }),
      step("profile", { status: "done", noop: true }),
    ])
    expect(quiet).toHaveLength(1)
    const loud = combinedRowResults([google("Store code")], [
      step("listing", { status: "done" }),
      step("profile", { status: "failed", message: "Stale." }),
    ])
    expect(loud.map((view) => view.label)).toEqual(["Store code", "profile"])
  })
})
