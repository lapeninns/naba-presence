import { describe, expect, it } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/locations/action-errors"

describe("describeActionError", () => {
  it("maps known wave-1 codes to plain copy without showing the code", () => {
    const cases: Array<[string, number, RegExp]> = [
      ["profile_snapshot_stale", 409, /changed since you loaded/i],
      ["google_hours_overwrite_confirmation_required", 409, /google changed/i],
      ["media_stale", 409, /changed on google/i],
      ["place_action_not_editable", 409, /cannot be edited/i],
      ["food_menus_not_eligible", 409, /cannot have a food menu/i],
      ["second_approver_required", 403, /different/i],
      ["posts_paused", 503, /paused/i],
      ["media_file_too_large", 413, /75 ?mb/i],
    ]
    for (const [code, status, pattern] of cases) {
      const copy = describeActionError(new ApiClientError(status, code, "raw server message"))
      expect(copy).toMatch(pattern)
      expect(copy).not.toContain(code)
    }
  })
  it("falls back to a generic message for unknown errors", () => {
    expect(describeActionError(new Error("boom"))).toMatch(/something went wrong/i)
  })
})
