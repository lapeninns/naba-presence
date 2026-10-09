import { describe, expect, it } from "vitest"

import { publishFailureCause } from "@/lib/inbox/publish-failure"

describe("publishFailureCause", () => {
  it("treats Google's verdict on the words as a content refusal", () => {
    expect(
      publishFailureCause({ googlePolicyViolation: "Contains a link" })
    ).toBe("content")
    expect(publishFailureCause({ publishStatus: "rejected" })).toBe("content")
    expect(publishFailureCause({ lastErrorCode: "INVALID_ARGUMENT" })).toBe(
      "content"
    )
  })

  it("names a lost grant or link as the connection", () => {
    for (const code of [
      "google_reconnect_required",
      "connection_disconnected",
      "UNAUTHENTICATED",
      "PERMISSION_DENIED",
    ]) {
      expect(publishFailureCause({ lastErrorCode: code })).toBe("connection")
    }
  })

  it("names timeouts and outages as transient", () => {
    for (const code of ["google_timeout", "network_error", "UNAVAILABLE"]) {
      expect(publishFailureCause({ lastErrorCode: code })).toBe("transient")
    }
  })

  it("does not guess without a code", () => {
    expect(publishFailureCause(null)).toBe("unknown")
    expect(publishFailureCause({ lastErrorCode: "something_new" })).toBe(
      "unknown"
    )
  })
})
