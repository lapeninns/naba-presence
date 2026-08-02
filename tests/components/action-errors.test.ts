import { describe, expect, it } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/inbox/action-errors"

describe("describeActionError", () => {
  it("uses the mandated second-approver copy", () => {
    expect(
      describeActionError(new ApiClientError(403, "second_approver_required", "x"))
    ).toBe("A different authorised user must approve this reply.")
  })

  it("maps ambiguous provider outcomes without leaking the code", () => {
    const copy = describeActionError(
      new ApiClientError(502, "google_mutation_ambiguous", "x")
    )
    expect(copy).toContain("Check its status")
    expect(copy).not.toContain("google_mutation_ambiguous")
  })

  it("falls back generically for unknown or non-API errors", () => {
    expect(describeActionError(new Error("boom"))).toBe(
      "Something went wrong. Please try again."
    )
    expect(
      describeActionError(new ApiClientError(500, "unheard_of", "x"))
    ).toBe("Something went wrong. Please try again.")
  })

  // U1: the publish path's grep-confirmed code set (lib/server/publishing.ts)
  // must map to plain copy, mirroring the M8 console-action-errors pattern —
  // never the raw code.
  it("maps every publish-path code to plain copy without showing the code", () => {
    const cases: Array<[string, RegExp]> = [
      ["review_changed", /re-verify/i],
      ["location_not_verified", /not verified/i],
      ["verification_failed", /could not confirm/i],
      ["verification_required", /re-verifying/i],
      ["stale_draft_evidence", /changed/i],
    ]
    for (const [code, pattern] of cases) {
      const copy = describeActionError(new ApiClientError(409, code, "raw"))
      expect(copy).toMatch(pattern)
      expect(copy).not.toContain(code)
    }
  })
})
