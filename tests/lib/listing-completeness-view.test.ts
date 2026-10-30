import { describe, expect, it } from "vitest"

import { importanceLabel, visibleFix } from "@/lib/listings/completeness-view"

describe("visibleFix", () => {
  const profile = {
    fix: { label: "Add phone number", href: "/listings/l1/profile" },
  }
  const verification = {
    fix: { label: "Start verification", href: "/listings/l1/verification" },
  }
  const inbox = {
    fix: { label: "Reply to reviews", href: "/inbox?locationId=l1" },
  }

  it("keeps every fix for owners and admins", () => {
    expect(visibleFix(profile, true)).toEqual(profile.fix)
    expect(visibleFix(verification, true)).toEqual(verification.fix)
    expect(visibleFix(inbox, true)).toEqual(inbox.fix)
  })

  it("drops a fix in an owner-only area for members", () => {
    expect(visibleFix(verification, false)).toBeNull()
    expect(visibleFix(profile, false)).toEqual(profile.fix)
    expect(visibleFix(inbox, false)).toEqual(inbox.fix)
  })

  it("has nothing to show without a fix", () => {
    expect(visibleFix({ fix: null }, true)).toBeNull()
  })
})

describe("importanceLabel", () => {
  it("names each level in plain words", () => {
    expect(importanceLabel("necessary")).toBe("Essential")
    expect(importanceLabel("important")).toBe("Important")
    expect(importanceLabel("nice")).toBe("Nice to have")
  })
})
