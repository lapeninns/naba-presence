import { describe, expect, it } from "vitest"

import { requiresPostApproval } from "@/lib/server/posts"

// The post twin of the reply pipeline's requiresApproval: who must ask before
// a post reaches Google, on every publication path (publish, PATCH of a live
// post, retry after an approved publish failed).
describe("requiresPostApproval", () => {
  const off = { requireTwoPersonApproval: false }
  const on = { requireTwoPersonApproval: true }

  it.each([
    // policy, canPublish, qualifying approval, must ask
    [off, false, false, true],
    [off, false, true, true],
    [off, true, false, false],
    [off, true, true, false],
    [on, false, false, true],
    [on, false, true, true],
    // A publisher in two-person mode asks unless someone else approved
    // exactly this revision.
    [on, true, false, true],
    [on, true, true, false],
  ] as const)(
    "policy %o, canPublish %s, approved %s -> asks %s",
    (policy, canPublish, approved, asks) => {
      expect(requiresPostApproval(policy, canPublish, approved)).toBe(asks)
    }
  )
})
