import { describe, expect, it } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import { describeActionError, isPausedError } from "@/lib/settings/action-errors"

describe("describeActionError", () => {
  it("maps known M6 codes to plain copy without showing the code", () => {
    const cases: Array<[string, number, RegExp]> = [
      ["direct_publish_consent_required", 403, /owner must/i],
      ["last_owner", 409, /last owner/i],
      ["cannot_remove_self", 409, /your own/i],
      ["use_invitations", 410, /invitation/i],
      ["invitation_pending", 409, /already/i],
      ["invitation_not_found", 404, /no longer|not found/i],
      ["privacy_legal_hold", 409, /legal hold/i],
      ["privacy_subject_not_found", 404, /no records/i],
      ["legal_hold_not_found", 404, /no active/i],
      ["relink_confirmation_required", 409, /confirm/i],
      ["location_already_linked", 409, /already linked/i],
      ["accounts_not_discovered", 409, /discover/i],
      ["google_reconnect_required", 401, /reconnect/i],
      ["sync_paused", 503, /paused/i],
      ["backfill_batch_running", 409, /in progress|running|wait/i],
      ["active_google_account_not_found", 404, /active Google account/i],
    ]
    for (const [code, status, pattern] of cases) {
      const copy = describeActionError(new ApiClientError(status, code, "raw server message"))
      expect(copy).toMatch(pattern)
      expect(copy).not.toContain(code)
    }
  })
  it("flags paused errors and falls back for unknown errors", () => {
    expect(isPausedError(new ApiClientError(503, "sync_paused", "x"))).toBe(true)
    expect(isPausedError(new Error("boom"))).toBe(false)
    expect(describeActionError(new Error("boom"))).toMatch(/something went wrong/i)
  })
})
