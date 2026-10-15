import {
  MutationObserver,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import * as React from "react"
import { describe, expect, it } from "vitest"

import {
  replyMutationKey,
  useReplyPending,
} from "@/lib/queries/use-reply-pending"

function setup() {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useReplyPending("r1"), { wrapper })
  // The shape of use-approval-decision: one mutation (and key) for both
  // decisions, with the decision in its input.
  const decide = (variables: unknown) => {
    const observer = new MutationObserver(client, {
      mutationKey: replyMutationKey("r1", "approval"),
      mutationFn: () => new Promise<never>(() => {}),
    })
    act(() => {
      void observer.mutate(variables as never).catch(() => {})
    })
  }
  return { hook, decide }
}

describe("useReplyPending", () => {
  it("is idle when nothing is in flight", () => {
    expect(setup().hook.result.current).toBeNull()
  })

  it("reports an approval while Approve is running", () => {
    const { hook, decide } = setup()
    decide({
      decision: "approve",
      draftId: "d1",
      expectedReviewUpdateTime: "t",
    })
    return waitFor(() => expect(hook.result.current).toBe("approval"))
  })

  it("reports a rejection, not an approval, while Reject is running", () => {
    const { hook, decide } = setup()
    decide({ decision: "reject", note: "Too long" })
    return waitFor(() => expect(hook.result.current).toBe("rejection"))
  })
})
