import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useReviewTriage } from "@/components/inbox/review-triage"
import { Toaster } from "@/components/ui/toast"
import type {
  BulkReviewActionInput,
  BulkReviewResult,
} from "@/lib/contracts/reviews"
import * as bulkHook from "@/lib/queries/use-bulk-review-action"

afterEach(() => vi.restoreAllMocks())

/**
 * The success titles a fully OK batch earns (p5 F06 C2, F07 C3): what
 * happened, not "N reviews updated". Driven through the hook, as the bulk bar
 * and the review's ⋯ menu drive it.
 */
function runWith(
  result: BulkReviewResult,
  input: BulkReviewActionInput,
  context?: { assigneeLabel?: string }
) {
  vi.spyOn(bulkHook, "useBulkReviewAction").mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(result),
    isPending: false,
  } as unknown as ReturnType<typeof bulkHook.useBulkReviewAction>)
  let run: ReturnType<typeof useReviewTriage>["run"] | undefined
  function Probe() {
    run = useReviewTriage().run
    return null
  }
  render(
    <Toaster>
      <Probe />
    </Toaster>
  )
  return act(async () => {
    await run!(input, context)
  })
}

const ok = (...ids: string[]): BulkReviewResult => ({
  results: ids.map((reviewId) => ({ reviewId, status: "ok" })),
})

describe("useReviewTriage outcome titles", () => {
  it("says approved replies went to Google, not that reviews were updated", async () => {
    await runWith(ok("a", "b"), {
      action: "approve",
      approvals: [
        { reviewId: "a", draftId: "d1", reviewUpdateTime: "t" },
        { reviewId: "b", draftId: "d2", reviewUpdateTime: "t" },
      ],
    })
    expect(
      await screen.findByText("2 replies approved and sent to Google")
    ).toBeInTheDocument()
  })

  it("counts an assignment without a name, as the bulk bar sends it", async () => {
    await runWith(ok("a", "b", "c"), {
      action: "assign",
      reviewIds: ["a", "b", "c"],
      assigneeId: "u1",
    })
    expect(await screen.findByText("3 reviews assigned")).toBeInTheDocument()
  })

  it("names the person when the menu passes one", async () => {
    await runWith(
      ok("a", "b"),
      { action: "assign", reviewIds: ["a", "b"], assigneeId: "u1" },
      { assigneeLabel: "Priya" }
    )
    expect(
      await screen.findByText("2 reviews assigned to Priya")
    ).toBeInTheDocument()
  })

  it("says unassigned for a batch assigned to no one", async () => {
    await runWith(ok("a", "b"), {
      action: "assign",
      reviewIds: ["a", "b"],
      assigneeId: null,
    })
    expect(await screen.findByText("2 reviews unassigned")).toBeInTheDocument()
  })

  it("keeps the counted summary when a batch is mixed", async () => {
    await runWith(
      {
        results: [
          { reviewId: "a", status: "ok" },
          { reviewId: "b", status: "skipped", code: "review_not_found" },
        ],
      },
      { action: "assign", reviewIds: ["a", "b"], assigneeId: "u1" },
      { assigneeLabel: "Priya" }
    )
    expect(await screen.findByText("1 updated, 1 skipped")).toBeInTheDocument()
  })
})
