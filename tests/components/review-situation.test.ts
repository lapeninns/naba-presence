import { describe, expect, it } from "vitest"

import {
  describeReplyState,
  describeSituation,
  isLiveOnGoogle,
  replyWork,
  situationFromReviewRow,
  type SituationInput,
} from "@/lib/inbox/review-situation"
import type { ReviewRow } from "@/lib/api/reviews"

function situation(overrides: Partial<SituationInput> = {}) {
  return describeSituation({
    workflowStatus: "new",
    verification: null,
    hasLiveReply: false,
    hasUnpublishedChanges: false,
    hasDraft: false,
    hasVerifiedDraft: false,
    canPublish: true,
    canRequestApproval: false,
    ...overrides,
  })
}

describe("describeSituation", () => {
  it("asks for a reply when nothing has been written", () => {
    expect(situation()).toMatchObject({
      tone: "neutral",
      headline: "No reply yet",
      chip: "New",
      detail: "Write a reply, or generate one to start.",
    })
  })

  it("reports a saved but unverified draft", () => {
    expect(situation({ workflowStatus: "drafted", hasDraft: true })).toMatchObject({
      headline: "Draft saved",
      chip: "Draft",
    })
  })

  it("reports a verified draft as ready", () => {
    expect(
      situation({ workflowStatus: "verified", hasDraft: true, hasVerifiedDraft: true })
    ).toMatchObject({ tone: "positive", headline: "Ready to publish", chip: "Ready" })
  })

  it("tells a non-publisher to send a verified draft for approval", () => {
    expect(
      situation({
        workflowStatus: "verified",
        hasDraft: true,
        hasVerifiedDraft: true,
        canPublish: false,
        canRequestApproval: true,
      }).detail
    ).toContain("Send it for approval")
  })

  it("counts blocking issues in the sentence, singular and plural", () => {
    const one = situation({
      workflowStatus: "drafted",
      hasDraft: true,
      verification: {
        verdict: "fail",
        reasons: [{ code: "c", severity: "fail", message: "m" }],
      },
    })
    expect(one).toMatchObject({ tone: "attention", headline: "Blocked by verification" })
    expect(one.detail).toBe("One issue has to be fixed before this can be published.")

    const two = situation({
      workflowStatus: "drafted",
      hasDraft: true,
      verification: {
        verdict: "fail",
        reasons: [
          { code: "a", severity: "fail", message: "m" },
          { code: "b", severity: "fail", message: "m" },
          { code: "c", severity: "warn", message: "m" },
        ],
      },
    })
    expect(two.detail).toBe("2 issues have to be fixed before this can be published.")
  })

  it("says a live reply is published", () => {
    expect(
      situation({ workflowStatus: "published", hasDraft: true, hasLiveReply: true })
    ).toMatchObject({ tone: "positive", headline: "Published" })
  })

  it("says Published when workflow is published even without hasLiveReply", () => {
    // Google-synced replies often keep publish_status `accepted` while
    // workflow_status is already `published`; a leftover verified draft must
    // not win and show "Ready to publish".
    expect(
      situation({
        workflowStatus: "published",
        hasDraft: true,
        hasVerifiedDraft: true,
        hasLiveReply: false,
      })
    ).toMatchObject({ tone: "positive", headline: "Published" })
  })

  it("flags an edit that has not gone live", () => {
    expect(
      situation({
        workflowStatus: "drafted",
        hasDraft: true,
        hasLiveReply: true,
        hasUnpublishedChanges: true,
      })
    ).toMatchObject({
      tone: "caution",
      headline: "Unpublished changes",
      chip: "Edited",
    })
  })

  // A verdict describes the draft in hand. Once a reply is live with nothing
  // newer behind it, an old "fail" is history — reporting it as "Blocked" over
  // a published reply would be a lie.
  it("ignores a stale failed verdict once the reply is live and settled", () => {
    expect(
      situation({
        workflowStatus: "published",
        hasDraft: true,
        hasLiveReply: true,
        verification: {
          verdict: "fail",
          reasons: [{ code: "c", severity: "fail", message: "m" }],
        },
      })
    ).toMatchObject({ headline: "Published" })
  })

  it("keeps reporting a failed verdict when the newer draft is the one that failed", () => {
    expect(
      situation({
        workflowStatus: "drafted",
        hasDraft: true,
        hasLiveReply: true,
        hasUnpublishedChanges: true,
        verification: {
          verdict: "fail",
          reasons: [{ code: "c", severity: "fail", message: "m" }],
        },
      })
    ).toMatchObject({ headline: "Blocked by verification" })
  })

  it("gives approvers and requesters different next steps while awaiting approval", () => {
    expect(
      situation({ workflowStatus: "awaiting_approval", canPublish: true }).detail
    ).toContain("Approve this reply")
    expect(
      situation({ workflowStatus: "awaiting_approval", canPublish: false }).detail
    ).toContain("A manager needs to approve")
  })

  it.each([
    ["failed", "Publishing failed"],
    ["rejected", "Reply rejected"],
    ["publish_requested", "Publishing"],
  ])("reports the %s workflow state ahead of anything else", (status, headline) => {
    expect(
      situation({ workflowStatus: status, hasDraft: true, hasLiveReply: true })
    ).toMatchObject({ headline })
  })
})

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
    expect(replyWork({ reply: null, drafts: [draft("Draft")] }).settled).toBe(false)
  })
})

describe("describeReplyState", () => {
  it("names each publish status rather than calling them all published", () => {
    expect(describeReplyState("published")).toMatchObject({ label: "Live on Google" })
    expect(describeReplyState("awaiting_approval")).toMatchObject({
      label: "Waiting for approval",
    })
    expect(describeReplyState("failed")).toMatchObject({ tone: "attention" })
    expect(describeReplyState(null)).toMatchObject({ label: "Not published" })
    expect(describeReplyState("something_new")).toMatchObject({ label: "Not published" })
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

describe("situationFromReviewRow", () => {
  function row(
    overrides: Partial<
      Pick<
        ReviewRow,
        | "workflowStatus"
        | "draftBody"
        | "replyBody"
        | "replyStatus"
        | "verificationStatus"
        | "capabilities"
      >
    > = {}
  ) {
    return {
      workflowStatus: "new",
      draftBody: null,
      replyBody: null,
      replyStatus: null,
      verificationStatus: null,
      capabilities: { canPublish: true, canEdit: true, canRequestApproval: false },
      ...overrides,
    }
  }

  it("maps an empty row to No reply yet", () => {
    expect(situationFromReviewRow(row())).toMatchObject({
      tone: "neutral",
      headline: "No reply yet",
    })
  })

  it("maps a verified draft to Ready to publish", () => {
    expect(
      situationFromReviewRow(
        row({
          workflowStatus: "verified",
          draftBody: "Thanks!",
          verificationStatus: "pass",
        })
      )
    ).toMatchObject({ tone: "positive", headline: "Ready to publish" })
  })

  it("maps a live reply to Published", () => {
    expect(
      situationFromReviewRow(
        row({
          workflowStatus: "published",
          draftBody: "Thanks!",
          replyBody: "Thanks!",
          replyStatus: "published",
          verificationStatus: "pass",
        })
      )
    ).toMatchObject({ tone: "positive", headline: "Published" })
  })

  it("maps an accepted Google reply with a leftover verified draft to Published", () => {
    expect(
      situationFromReviewRow(
        row({
          workflowStatus: "published",
          draftBody: "Thanks!",
          replyBody: "Thanks!",
          replyStatus: "accepted",
          verificationStatus: "pass",
        })
      )
    ).toMatchObject({ tone: "positive", headline: "Published" })
  })

  it("maps a newer draft over a live reply to Unpublished changes", () => {
    expect(
      situationFromReviewRow(
        row({
          workflowStatus: "drafted",
          draftBody: "Thanks so much!",
          replyBody: "Thanks!",
          replyStatus: "published",
          verificationStatus: "pass",
        })
      )
    ).toMatchObject({ tone: "caution", headline: "Unpublished changes" })
  })
})
