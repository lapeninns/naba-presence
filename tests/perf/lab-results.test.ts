import { describe, expect, it } from "vitest"

import { checkBudgets } from "./budgets.mjs"
import {
  interactionTiming,
  listingHealthForLabel,
  measurementProblems,
  METRIC_KEYS,
  sameLanding,
  sampleProblems,
  summarizeRoute,
} from "./lab-results.mjs"

const sample = (overrides: Record<string, unknown> = {}) => ({
  ...Object.fromEntries(METRIC_KEYS.map((key) => [key, 1])),
  route: "/listings",
  finalUrl: "/listings",
  status: 200,
  firstLoadJsTransfer: 400 * 1024,
  firstLoadJsRequests: 3,
  errors: [],
  quietWindow: { completed: true },
  probe: {
    selector: '[aria-label="Filter by health"] button',
    actionCompleted: true,
    outcomeRequired: true,
    outcomeVerified: true,
    inp: 8,
    timingEntries: 1,
    timingSource: "first-input",
    timingEvidence: [{ t: 110, d: 8, id: 0, first: true, matchesProbe: true }],
  },
  ...overrides,
})

const event = (overrides: Record<string, unknown> = {}) => ({
  t: 110,
  d: 24,
  id: 7,
  name: "click",
  matchesProbe: true,
  input: 2,
  proc: 4,
  ...overrides,
})

describe("lab interaction evidence", () => {
  it("retains real first-input evidence when Chromium reports interaction ID zero", () => {
    expect(
      interactionTiming([event({ id: 0, first: true, d: 8 })], 100, 200)
    ).toMatchObject({
      inp: 8,
      interactionId: 0,
      timingSource: "first-input",
      timingEntries: 1,
    })
  })

  it("distinguishes an observed rounded zero duration from no observation", () => {
    const measured = interactionTiming(
      [event({ id: 0, first: true, d: 0 })],
      100,
      200
    )
    expect(measured.inp).toBe(0)
    expect(measured.timingEntries).toBe(1)
    expect(measured.timingEvidence).toHaveLength(1)
    expect(interactionTiming([], 100, 200)).toMatchObject({
      inp: null,
      timingSource: null,
      timingEntries: 0,
      timingEvidence: [],
    })
  })

  it("reports the longest actual attributed event rather than input or processing delay", () => {
    const result = interactionTiming(
      [
        event({ first: true, id: 0, d: 8 }),
        event({ d: 56, input: 3, proc: 5 }),
      ],
      100,
      200
    )
    expect(result).toMatchObject({
      inp: 56,
      input: 3,
      processing: 5,
      timingSource: "event",
      timingEntries: 2,
    })
  })

  it.each([
    { matchesProbe: false },
    { t: 99 },
    { t: 201 },
    { d: Number.NaN },
    { d: Number.POSITIVE_INFINITY },
    { d: -1 },
    { id: 0 },
  ])("rejects unrelated, out-of-window or invalid evidence %j", (overrides) => {
    expect(interactionTiming([event(overrides)], 100, 200).inp).toBeNull()
  })

  it("maps counted current health-chip labels to their actual URL state", () => {
    expect(listingHealthForLabel("Needs attention\n 2")).toEqual({
      label: "Needs attention",
      value: "attention",
    })
    expect(listingHealthForLabel("In sync, 0")).toEqual({
      label: "In sync",
      value: "healthy",
    })
    expect(listingHealthForLabel("To publish 1")).toEqual({
      label: "To publish",
      value: "unpublished",
    })
    expect(listingHealthForLabel("All 12")).toEqual({
      label: "All",
      value: "all",
    })
    expect(listingHealthForLabel("Not linked 1")).toEqual({
      label: "Not linked",
      value: "not_linked",
    })
    expect(listingHealthForLabel("Needs attention elsewhere")).toBeNull()
    expect(listingHealthForLabel("Unrecognised control")).toBeNull()
  })
})

describe("cold sample qualification", () => {
  it("accepts complete error-free navigation, quiet and interaction evidence", () => {
    expect(sampleProblems(sample())).toEqual([])
  })

  it.each([
    [{ status: 503 }, "HTTP status 503"],
    [{ finalUrl: "/sign-in?next=%2Flistings" }, "unexpected landing URL"],
    [{ errors: ["Failed to fetch"] }, "page or console errors"],
    [
      { quietWindow: { completed: false, inflight: 1 } },
      "quiet window did not complete",
    ],
    [{ lcp: null }, "unavailable metric lcp"],
    [{ firstLoadJsTransfer: 0 }, "first-load JavaScript was not observed"],
  ])("rejects invalid load evidence %j", (overrides, reason) => {
    expect(
      sampleProblems(sample(overrides as Record<string, unknown>))
    ).toContain(reason)
  })

  it("rejects a missing control or a click whose health state did not change", () => {
    const original = sample()
    expect(
      sampleProblems(
        sample({
          probe: { ...original.probe, selector: null, actionCompleted: false },
        })
      )
    ).toContain("interaction control was not activated")
    expect(
      sampleProblems(
        sample({ probe: { ...original.probe, outcomeVerified: false } })
      )
    ).toContain("interaction outcome was not verified")
  })

  it("rejects absent timing even if a control was clicked and its state changed", () => {
    const original = sample()
    expect(
      sampleProblems(
        sample({ probe: { ...original.probe, inp: null, timingEntries: 0 } })
      )
    ).toContain("interaction timing unavailable")
    expect(
      sampleProblems(
        sample({ probe: { ...original.probe, inp: 0, timingEntries: 0 } })
      )
    ).toContain("interaction timing unavailable")
    expect(
      sampleProblems(
        sample({ probe: { ...original.probe, inp: 0, timingEvidence: [] } })
      )
    ).toContain("interaction timing unavailable")
  })

  it("keeps an explicit probe failure invalid even if some timing was observed", () => {
    expect(
      sampleProblems(
        sample({ probe: { ...sample().probe, error: "Outcome timed out" } })
      )
    ).toContain("interaction probe failed: Outcome timed out")
  })

  it("compares navigation paths and query state without depending on query ordering", () => {
    expect(sameLanding("/inbox?a=1&b=2", "/inbox?b=2&a=1")).toBe(true)
    expect(sameLanding("/listings", "/listings?health=attention")).toBe(false)
    expect(sameLanding("/listings", "https://other.example/listings")).toBe(
      false
    )
  })

  it("computes medians across valid runs while preserving invalid-run failure", () => {
    const result = summarizeRoute(
      "/listings",
      [
        sample({ lcp: 100 }),
        sample({ status: 503, lcp: 9000 }),
        sample({ lcp: 300 }),
      ],
      3
    )
    expect(result).toMatchObject({
      valid: false,
      runs: 2,
      expectedRuns: 3,
      lcp: 200,
    })
    expect(result.validationErrors).toContain("run 2: HTTP status 503")
  })

  it("cannot qualify a reduced successful subset or an exception as the requested full batch", () => {
    const short = summarizeRoute("/listings", [sample(), sample()], 3)
    expect(short).toMatchObject({ valid: false, runs: 2, expectedRuns: 3 })
    expect(short.validationErrors).toContain("expected 3 runs, received 2")
    const failed = summarizeRoute(
      "/listings",
      [{ error: "Navigation timed out" }],
      1
    )
    expect(failed).toMatchObject({
      valid: false,
      runs: 0,
      lcp: null,
      inp: null,
    })
    expect(failed.validationErrors).toContain("run 1: Navigation timed out")
  })

  it("rechecks raw saved-run validity instead of trusting passing medians", () => {
    const result = {
      runs: 2,
      summary: [{ route: "/listings", lcp: 1 }],
      samples: { "/listings": [sample()] },
    }
    expect(measurementProblems(result)).toContain(
      "/listings: expected 2 runs, received 1"
    )
    expect(measurementProblems({ ...result, samples: undefined })).toContain(
      "raw samples unavailable"
    )
    expect(measurementProblems({ ...result, runs: 0 })).toContain(
      "expected run count unavailable"
    )
    expect(measurementProblems({ ...result, summary: [] })).toContain(
      "no route summaries"
    )
  })
})

describe("budget evidence", () => {
  const budgets = {
    mobile: { default: { inp: 150, firstLoadJsTransfer: 520 } },
  }
  const row = { route: "/listings", inp: 150, firstLoadJsTransfer: 520 * 1024 }

  it("keeps maxima inclusive and converts byte metrics using 1024 bytes per KB", () => {
    expect(checkBudgets([row], budgets, "mobile")).toEqual([])
    expect(
      checkBudgets(
        [{ ...row, firstLoadJsTransfer: 521 * 1024 }],
        budgets,
        "mobile"
      )
    ).toContain("/listings: firstLoadJsTransfer 521 KB > 520")
  })

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, "100", -1])(
    "fails a missing or invalid required metric %j",
    (inp) => {
      expect(checkBudgets([{ ...row, inp }], budgets, "mobile")).toContain(
        "/listings: required metric inp unavailable"
      )
    }
  )

  it("retains explicit route overrides and intentionally disabled metrics", () => {
    const overridden = {
      mobile: { default: { inp: 150 }, routes: { "/listings": { inp: 8 } } },
    }
    expect(checkBudgets([{ ...row, inp: 9 }], overridden, "mobile")).toContain(
      "/listings: inp 9 > 8"
    )
    expect(
      checkBudgets(
        [{ route: "/listings" }],
        { mobile: { default: { inp: null, _note: "disabled explicitly" } } },
        "mobile"
      )
    ).toEqual([])
  })

  it("does not call an invalid measurement, missing profile or empty sweep passing", () => {
    expect(
      checkBudgets([{ ...row, valid: false }], budgets, "mobile")
    ).toContain("/listings: measurement qualification failed")
    expect(checkBudgets([row], budgets, "desktop")).toContain(
      "No default budgets configured for desktop"
    )
    expect(checkBudgets([], budgets, "mobile")).toContain(
      "No route measurements to check"
    )
    expect(
      checkBudgets([row], { mobile: { default: { inp: "150" } } }, "mobile")
    ).toContain("/listings: invalid budget for inp")
  })
})
