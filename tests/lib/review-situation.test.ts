import { describe, expect, it } from "vitest"

import {
  describeReplyState,
  isLiveOnGoogle,
  replyWork,
  shownDraft,
} from "@/lib/inbox/review-situation"

/**
 * The narrative half of this module — `describeSituation` and
 * `situationFromReviewRow` — moved to lib/inbox/reply-state.ts so that the
 * wording and the footer button come from one ladder. Its cases now live in
 * tests/components/reply-state.test.ts; what remains here is the wire
 * vocabulary the rest of the inbox still reads off this module.
 */

describe("replyWork", () => {
  const draft = (body: string) => ({ body })

  it("treats a non-published reply as nothing live", () => {
    const work = replyWork({
      reply: { body: "Pending text", publishStatus: "awaiting_approval" },
      drafts: [draft("Pending text")],
    })
    expect(work.liveBody).toBeNull()
    expect(work.settled).toBe(false)
  })

  it("treats an accepted reply as on Google for settled / situation work", () => {
    const work = replyWork({
      reply: { body: "Thanks!", publishStatus: "accepted" },
      drafts: [draft("Thanks!")],
    })
    expect(work.liveBody).toBe("Thanks!")
    expect(work.settled).toBe(true)
  })

  it("settles when the live reply and the newest draft say the same thing", () => {
    const work = replyWork({
      reply: { body: "Thanks!", publishStatus: "published" },
      drafts: [draft("Thanks!")],
    })
    expect(work).toMatchObject({ hasUnpublishedChanges: false, settled: true })
  })

  it("settles when a reply is live and no draft exists at all", () => {
    const work = replyWork({
      reply: { body: "Thanks!", publishStatus: "published" },
      drafts: [],
    })
    expect(work.settled).toBe(true)
  })

  it("does not settle while a newer draft differs from what is live", () => {
    const work = replyWork({
      reply: { body: "Thanks!", publishStatus: "published" },
      drafts: [draft("Thanks so much!")],
    })
    expect(work).toMatchObject({ hasUnpublishedChanges: true, settled: false })
  })

  it("does not settle when nothing has ever been published", () => {
    expect(replyWork({ reply: null, drafts: [draft("Draft")] }).settled).toBe(
      false
    )
  })
})

describe("shownDraft", () => {
  const drafts = [
    { id: "d-newer", body: "Unsubmitted." },
    { id: "d-parked", body: "Parked." },
  ]
  const pendingDraft = { id: "d-parked", body: "Parked." }

  it("shows the parked draft while the reply awaits approval", () => {
    const review = { workflowStatus: "awaiting_approval", pendingDraft, drafts }
    expect(shownDraft(review)).toEqual(pendingDraft)
    expect(replyWork({ ...review, reply: null }).draftBody).toBe("Parked.")
  })

  it("shows the newest draft otherwise, or when the server sent none", () => {
    expect(
      shownDraft({ workflowStatus: "verified", pendingDraft, drafts })?.id
    ).toBe("d-newer")
    expect(
      shownDraft({ workflowStatus: "awaiting_approval", drafts })?.id
    ).toBe("d-newer")
    expect(
      shownDraft({
        workflowStatus: "awaiting_approval",
        pendingDraft: null,
        drafts,
      })?.id
    ).toBe("d-newer")
  })
})

describe("describeReplyState", () => {
  it("names each publish status rather than calling them all published", () => {
    expect(describeReplyState("published")).toMatchObject({
      label: "Live on Google",
    })
    expect(describeReplyState("awaiting_approval")).toMatchObject({
      label: "Waiting for approval",
    })
    expect(describeReplyState("failed")).toMatchObject({ tone: "attention" })
    expect(describeReplyState(null)).toMatchObject({ label: "Not published" })
    expect(describeReplyState("something_new")).toMatchObject({
      label: "Not published",
    })
  })
})

describe("isLiveOnGoogle", () => {
  it("accepts only 'published' — 'accepted' is in flight, not live", () => {
    expect(isLiveOnGoogle("published")).toBe(true)
    expect(isLiveOnGoogle("accepted")).toBe(false)
    expect(isLiveOnGoogle(null)).toBe(false)
    expect(isLiveOnGoogle(undefined)).toBe(false)
  })
})
