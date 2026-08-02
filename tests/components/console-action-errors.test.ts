import { describe, expect, it } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/locations/action-errors"

describe("describeActionError — M8 console codes", () => {
  it("maps every new console code to plain copy without showing the code", () => {
    const cases: Array<[string, number, RegExp]> = [
      ["business_information_paused", 503, /unavailable/i],
      ["business_information_stale", 409, /changed on google/i],
      ["attributes_stale", 409, /changed on google/i],
      ["business_information_readback_mismatch", 502, /did not confirm/i],
      ["google_writes_paused", 503, /unavailable/i],
      ["business_calls_mask_invalid", 422, /calls setting/i],
      ["publish_not_allowed", 403, /permission/i],
      ["permission_denied", 403, /permission/i],
    ]
    for (const [code, status, pattern] of cases) {
      const copy = describeActionError(new ApiClientError(status, code, "raw"))
      expect(copy).toMatch(pattern)
      expect(copy).not.toContain(code)
    }
  })
})
