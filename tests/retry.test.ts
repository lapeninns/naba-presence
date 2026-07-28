import { describe, expect, it } from "vitest"

import { isRetryableGoogleStatus, retryDelayMs } from "@/lib/domain/retry"

describe("Google retry policy", () => {
  it.each([408, 429, 500, 502, 503, 504])("retries HTTP %s", (status) => {
    expect(isRetryableGoogleStatus(status)).toBe(true)
  })

  it.each([400, 401, 403, 404, 409, 422])(
    "does not retry permanent HTTP %s",
    (status) => {
      expect(isRetryableGoogleStatus(status)).toBe(false)
    }
  )

  it("uses capped exponential backoff with jitter", () => {
    expect(retryDelayMs(1, () => 0)).toBe(250)
    expect(retryDelayMs(2, () => 1)).toBe(1000)
    expect(retryDelayMs(20, () => 1)).toBe(30_000)
  })
})
