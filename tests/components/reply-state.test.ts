import { describe, expect, it } from "vitest"

import {
  derivePrimaryAction,
  deriveReplyStatus,
  hasVerifiedDraft,
  publishableDraft,
  replyStateFromRow,
  type ReplyPendingKind,
  type ReplyStateInput,
} from "@/lib/inbox/reply-state"

/**
 * lib/inbox/reply-state.ts is the single derivation behind both the status line
 * and the footer button. Before it existed those two answers were computed
 * separately and could disagree on sight — a tracker lighting "Published" over
 * a reply that had never been sent, a row saying "Ready" beside a pane saying
 * "Draft saved". The suite therefore checks each branch in isolation AND the
 * invariant that ties them together (see "status and action agree" below).
 */

function input(overrides: Partial<ReplyStateInput> = {}): ReplyStateInput {
  return {
    workflowStatus: "new",
    capabilities: {
      canPublish: true,
      canEdit: true,
      canRequestApproval: false,
    },
    reply: null,
    drafts: [],
    verification: null,
    isDirty: false,
    ...overrides,
  }
}

const draft = (body: string, verificationStatus: string | null = null) => ({
  body,
  verificationStatus,
})

/** A verified draft sitting on a review that is allowed to move to publishing. */
const readyToPublish = () =>
  input({
    workflowStatus: "verified",
    drafts: [draft("Thanks for staying with us!", "pass")],
    verification: { verdict: "pass", reasons: [] },
  })

/** The same, except a reply is already live and the draft revises it. */
const readyToUpdate = () =>
  input({
    workflowStatus: "verified",
    reply: { body: "Thanks!", publishStatus: "published" },
    drafts: [draft("Thanks so much for staying with us!", "pass")],
    verification: { verdict: "pass", reasons: [] },
  })

/** A live reply with nothing newer behind it: there is nothing left to send. */
const settledReview = (publishStatus = "published") =>
  input({
    workflowStatus: "published",
    reply: { body: "Thanks!", publishStatus },
    drafts: [draft("Thanks!", "pass")],
    verification: { verdict: "pass", reasons: [] },
  })

describe("hasVerifiedDraft / publishableDraft", () => {
  it("accepts a pass or a warn, and nothing else", () => {
    expect(hasVerifiedDraft([draft("a", "pass")])).toBe(true)
    expect(hasVerifiedDraft([draft("a", "warn")])).toBe(true)
    expect(hasVerifiedDraft([draft("a", "fail")])).toBe(false)
    expect(hasVerifiedDraft([draft("a", null)])).toBe(false)
    expect(hasVerifiedDraft([])).toBe(false)
  })

  // This is the bug the function was written to close. Drafts arrive
  // newest-first and the composer edits drafts[0], so a search for "any
  // verified draft in the list" would answer yes about superseded text while
  // the operator reads an unverified newer draft — and the publish would then
  // send words that are not on screen.
  it("ignores an older verified draft when the newest one is unverified", () => {
    const drafts = [
      draft("Newest, unchecked", null),
      draft("Older, checked", "pass"),
    ]

    expect(hasVerifiedDraft(drafts)).toBe(false)
    expect(publishableDraft(drafts)).toBeUndefined()

    const action = derivePrimaryAction(
      input({ workflowStatus: "verified", drafts })
    )
    expect(action.enabled).toBe(false)
    expect(action.reason).toBe("Save and verify a draft before publishing.")
  })

  it("returns the newest draft, and only when that one is verified", () => {
    const newest = draft("Newest, checked", "pass")
    expect(publishableDraft([newest, draft("Older", "pass")])).toBe(newest)
    expect(publishableDraft([draft("Newest", "fail"), newest])).toBeUndefined()
    expect(publishableDraft([])).toBeUndefined()
  })
})

describe("derivePrimaryAction — which action applies", () => {
  it("offers Publish for a verified draft with nothing live", () => {
    expect(derivePrimaryAction(readyToPublish())).toMatchObject({
      kind: "publish",
      label: "Publish reply",
      enabled: true,
      settled: false,
      reason: undefined,
    })
  })

  it("offers Update once a reply is live and the draft revises it", () => {
    expect(derivePrimaryAction(readyToUpdate())).toMatchObject({
      kind: "update",
      label: "Update reply",
      enabled: true,
    })
  })

  it("offers Submit for approval to someone who may request but not publish", () => {
    const action = derivePrimaryAction({
      ...readyToPublish(),
      capabilities: {
        canPublish: false,
        canEdit: true,
        canRequestApproval: true,
      },
    })
    expect(action).toMatchObject({
      kind: "submit",
      label: "Submit for approval",
      enabled: true,
    })
  })

  it("offers Approve while the reply is awaiting approval", () => {
    expect(
      derivePrimaryAction(input({ workflowStatus: "awaiting_approval" }))
    ).toMatchObject({ kind: "approve", label: "Approve reply", enabled: true })
  })

  // The approval decision is the top branch, so it must win even for an
  // operator whose capabilities would otherwise put them on the submit path.
  it("keeps Approve ahead of Submit for a requester who cannot publish", () => {
    const action = derivePrimaryAction(
      input({
        workflowStatus: "awaiting_approval",
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: true,
        },
      })
    )
    expect(action.kind).toBe("approve")
    expect(action.reason).toBe(
      "You do not have permission to approve for this location."
    )
    expect(action.enabled).toBe(false)
  })
})

describe("derivePrimaryAction — availability and reasons", () => {
  it("reports the missing permission ahead of the missing draft", () => {
    expect(
      derivePrimaryAction(
        input({
          capabilities: {
            canPublish: false,
            canEdit: true,
            canRequestApproval: false,
          },
        })
      ).reason
    ).toBe("You do not have permission to publish for this location.")
  })

  it("asks for a verified draft before anything else an operator can act on", () => {
    expect(
      derivePrimaryAction(input({ drafts: [draft("Unchecked")] })).reason
    ).toBe("Save and verify a draft before publishing.")
  })

  it("asks for a save while the composer is dirty", () => {
    expect(
      derivePrimaryAction({ ...readyToPublish(), isDirty: true }).reason
    ).toBe("Save your draft before publishing.")
  })

  it("falls back to the transition wall once the draft is in order", () => {
    // `new` has no path to `publish_requested`, so with a verified, saved
    // draft in hand the workflow status is the only thing left to report.
    expect(
      derivePrimaryAction({ ...readyToPublish(), workflowStatus: "new" }).reason
    ).toBe("This reply cannot be published from its current status.")
  })

  it("words the same ladder for the submit path", () => {
    const submitter = {
      canPublish: false,
      canEdit: true,
      canRequestApproval: true,
    }
    expect(
      derivePrimaryAction(
        input({ capabilities: submitter, drafts: [draft("x")] })
      ).reason
    ).toBe("Verify a draft before submitting it for approval.")
    expect(
      derivePrimaryAction({
        ...readyToPublish(),
        capabilities: submitter,
        isDirty: true,
      }).reason
    ).toBe("Save your draft before submitting it for approval.")
    expect(
      derivePrimaryAction({
        ...readyToPublish(),
        capabilities: submitter,
        workflowStatus: "new",
      }).reason
    ).toBe(
      "This reply cannot be submitted for approval from its current status."
    )
  })

  it("calls a live reply with no newer draft settled rather than blocked", () => {
    expect(derivePrimaryAction(settledReview())).toMatchObject({
      settled: true,
      enabled: false,
      reason: "Edit the reply above to publish a change.",
    })
  })

  // `settled` is computed from server state, which still says "nothing
  // pending" while the composer holds unsaved edits. Without the dirty check
  // the pane would tell you to edit a reply you are in the middle of editing.
  it("stops reporting settled the moment the composer goes dirty", () => {
    const action = derivePrimaryAction({ ...settledReview(), isDirty: true })
    expect(action.settled).toBe(false)
    expect(action.reason).toBe("Save your draft before publishing.")
  })

  it("never settles an approval decision", () => {
    expect(
      derivePrimaryAction({
        ...settledReview(),
        workflowStatus: "awaiting_approval",
      }).settled
    ).toBe(false)
  })

  it("disables the button and drops the reason while a mutation is in flight", () => {
    const action = derivePrimaryAction({
      ...readyToPublish(),
      pending: "publish",
    })
    expect(action).toMatchObject({
      enabled: false,
      reason: undefined,
      pendingLabel: "Publishing…",
    })
  })

  it.each([
    ["submit", "Submitting…"],
    ["approve", "Approving…"],
    ["reject", "Rejecting…"],
  ] as const)("labels the in-flight %s", (pending, pendingLabel) => {
    expect(
      derivePrimaryAction({ ...readyToPublish(), pending }).pendingLabel
    ).toBe(pendingLabel)
  })

  // Saving and generating happen in the composer, not the footer, so the
  // primary button has no wording of its own for them — it just goes quiet.
  it("has no in-flight wording for a save or a generate", () => {
    for (const pending of ["save", "generate"] as const) {
      const action = derivePrimaryAction({ ...readyToPublish(), pending })
      expect(action.pendingLabel).toBeUndefined()
      expect(action.enabled).toBe(false)
    }
  })
})

describe("deriveReplyStatus", () => {
  it("asks for a reply when nothing has been written", () => {
    expect(deriveReplyStatus(input())).toMatchObject({
      text: "No draft yet",
      short: "Needs reply",
      tone: "neutral",
    })
  })

  it.each([
    ["publish", "Publishing reply", "Publishing"],
    ["submit", "Submitting for approval", "Submitting"],
    ["approve", "Recording your approval", "Approving"],
    ["reject", "Sending the reply back", "Rejecting"],
    ["save", "Saving and checking the draft", "Saving draft"],
    ["generate", "Generating a draft", "Generating"],
  ] as [ReplyPendingKind, string, string][])(
    "reports the in-flight %s above everything else",
    (pending, text, short) => {
      expect(deriveReplyStatus({ ...readyToPublish(), pending })).toMatchObject(
        {
          text,
          short,
          icon: "loader",
        }
      )
    }
  )

  it.each([
    ["publish_requested", "Publishing reply", "Publishing", "neutral"],
    ["failed", "Publish failed", "Publish failed", "attention"],
    ["rejected", "Sent back for changes", "Sent back", "caution"],
  ])(
    "lets the %s workflow state outrank the draft in hand",
    (workflowStatus, text, short, tone) => {
      expect(
        deriveReplyStatus({ ...readyToPublish(), workflowStatus })
      ).toMatchObject({ text, short, tone })
    }
  )

  it("reports unsaved edits ahead of the saved draft's own state", () => {
    expect(
      deriveReplyStatus({ ...readyToPublish(), isDirty: true })
    ).toMatchObject({
      text: "Unsaved changes · Save draft",
      short: "Unsaved changes",
      icon: "pen",
    })
  })

  it("asks for a check when the saved draft has no verdict", () => {
    expect(
      deriveReplyStatus(
        input({ workflowStatus: "drafted", drafts: [draft("Unchecked")] })
      )
    ).toMatchObject({ text: "Draft needs checking", short: "Check draft" })
  })

  it("asks for a correction when the verdict failed", () => {
    expect(
      deriveReplyStatus(
        input({
          workflowStatus: "drafted",
          drafts: [draft("Bad draft", "fail")],
          verification: {
            verdict: "fail",
            reasons: [{ code: "c", severity: "fail", message: "m" }],
          },
        })
      )
    ).toMatchObject({
      text: "Draft needs a correction",
      short: "Check needed",
      tone: "attention",
    })
  })

  it("reads a checked draft as ready to publish, or to update over a live reply", () => {
    expect(deriveReplyStatus(readyToPublish())).toMatchObject({
      text: "Draft checked · Ready to publish",
      short: "Ready to publish",
      tone: "neutral",
      icon: "check",
    })
    expect(deriveReplyStatus(readyToUpdate())).toMatchObject({
      text: "Draft checked · Ready to update",
      short: "Update ready",
    })
  })

  it("carries a warn verdict into the ready wording", () => {
    const warned = {
      drafts: [draft("Thanks so much for staying with us!", "warn")],
      verification: { verdict: "warn" as const, reasons: [] },
    }
    expect(deriveReplyStatus({ ...readyToPublish(), ...warned })).toMatchObject(
      {
        text: "Checked with a note · Ready to publish",
        short: "Ready to publish",
        tone: "caution",
      }
    )
    expect(deriveReplyStatus({ ...readyToUpdate(), ...warned })).toMatchObject({
      text: "Checked with a note · Ready to update",
      short: "Update ready",
    })
  })

  it("tells a requester their checked draft needs an approver", () => {
    expect(
      deriveReplyStatus({
        ...readyToPublish(),
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: true,
        },
      })
    ).toMatchObject({
      text: "Draft checked · Approval required",
      short: "Approval required",
      tone: "caution",
    })
  })

  // Two different walls, and the copy has to say which: one is a permission
  // the operator will never satisfy, the other a transition that will open.
  it("distinguishes a permission wall from a transition wall", () => {
    expect(
      deriveReplyStatus({
        ...readyToPublish(),
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: false,
        },
      })
    ).toMatchObject({
      text: "Publisher needed",
      short: "Publisher needed",
      icon: "lock",
    })
    expect(
      deriveReplyStatus({ ...readyToPublish(), workflowStatus: "new" })
    ).toMatchObject({ text: "Cannot be sent yet", short: "Not ready" })
  })
})

describe("deriveReplyStatus — what counts as published", () => {
  // Rule (a): only a confirmed `published` publish_status may read as
  // published. `accepted` means Google took the request and has not yet said
  // what became of it, and a `publish_requested` review is still in flight.
  it("says Reply published only for a confirmed published publish_status", () => {
    expect(deriveReplyStatus(settledReview("published"))).toMatchObject({
      text: "Reply published",
      short: "Replied",
    })
  })

  it("says Sent to Google for an accepted reply, not published", () => {
    const status = deriveReplyStatus(settledReview("accepted"))
    expect(status).toMatchObject({ text: "Sent to Google", short: "Sent" })
    expect(status.text).not.toMatch(/published/i)
  })

  it("says Publishing reply while the publish is requested", () => {
    const status = deriveReplyStatus({
      ...settledReview("accepted"),
      workflowStatus: "publish_requested",
    })
    expect(status.text).toBe("Publishing reply")
    expect(status.text).not.toMatch(/published/i)
  })

  // Rule (b): nothing is ever inferred from the availability of an action.
  // Being ABLE to publish is "Ready to publish"; it is never "Published" —
  // which is exactly what the old five-stage tracker got wrong.
  it("never reads a publishable draft as already published", () => {
    const status = deriveReplyStatus(readyToPublish())
    expect(status.text).toBe("Draft checked · Ready to publish")
    expect(status.text).not.toMatch(/published/i)
    expect(status.short).not.toMatch(/published|replied|sent/i)
  })
})

describe("deriveReplyStatus — approval scope", () => {
  const awaiting = { workflowStatus: "awaiting_approval" }

  it("names your own decision when the queue says it is yours", () => {
    expect(
      deriveReplyStatus(input({ ...awaiting, approvalScope: "me" }))
    ).toMatchObject({
      text: "Approval required",
      short: "For approval",
      tone: "caution",
    })
  })

  it("points at someone else when the queue says it is theirs", () => {
    expect(
      deriveReplyStatus(input({ ...awaiting, approvalScope: "others" }))
    ).toMatchObject({
      text: "Waiting for another approver",
      short: "Awaiting approval",
    })
  })

  // The aggregate Approval tab mixes both ownerships, so nobody has told us
  // whose decision this is. `canPublish` is a location grant that stays true
  // for the very person who requested the approval, so guessing from it would
  // announce "your approval is required" to an operator who may not approve.
  it("declines to guess whose approval it is when the scope is unknown", () => {
    for (const scope of ["unknown", undefined] as const) {
      expect(
        deriveReplyStatus(input({ ...awaiting, approvalScope: scope }))
      ).toMatchObject({
        text: "Waiting for approval",
        short: "Awaiting approval",
      })
    }
  })

  it("still declines to guess for an operator who happens to hold canPublish", () => {
    expect(
      deriveReplyStatus(
        input({
          ...awaiting,
          approvalScope: "unknown",
          capabilities: {
            canPublish: true,
            canEdit: true,
            canRequestApproval: false,
          },
        })
      ).text
    ).toBe("Waiting for approval")
  })
})

/**
 * The whole point of one derivation: the sentence and the button cannot
 * disagree. These two implications are checked across a spread of inputs
 * rather than case by case, so a new branch in either ladder has to keep them.
 */
describe("status and action agree", () => {
  const cases: [string, ReplyStateInput][] = [
    ["an untouched review", input()],
    [
      "an unchecked draft",
      input({ workflowStatus: "drafted", drafts: [draft("x")] }),
    ],
    [
      "a failed verdict",
      input({
        workflowStatus: "drafted",
        drafts: [draft("x", "fail")],
        verification: { verdict: "fail", reasons: [] },
      }),
    ],
    ["a publishable draft", readyToPublish()],
    ["a publishable update", readyToUpdate()],
    [
      "a warned publishable draft",
      { ...readyToPublish(), verification: { verdict: "warn", reasons: [] } },
    ],
    ["a dirty composer", { ...readyToPublish(), isDirty: true }],
    [
      "a stale verified draft",
      input({
        workflowStatus: "verified",
        drafts: [draft("new", null), draft("old", "pass")],
      }),
    ],
    [
      "a non-publisher",
      {
        ...readyToPublish(),
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: false,
        },
      },
    ],
    [
      "a requester",
      {
        ...readyToPublish(),
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: true,
        },
      },
    ],
    [
      "a review awaiting approval",
      input({ workflowStatus: "awaiting_approval" }),
    ],
    ["a settled published reply", settledReview("published")],
    ["a settled accepted reply", settledReview("accepted")],
    [
      "an in-flight publish",
      { ...readyToPublish(), workflowStatus: "publish_requested" },
    ],
    ["a failed publish", { ...readyToPublish(), workflowStatus: "failed" }],
    ["a returned reply", { ...readyToPublish(), workflowStatus: "rejected" }],
    ["a blocked transition", { ...readyToPublish(), workflowStatus: "new" }],
    ["a pending publish", { ...readyToPublish(), pending: "publish" as const }],
  ]

  it.each(cases)("keeps %s consistent", (_name, state) => {
    const action = derivePrimaryAction(state)
    const status = deriveReplyStatus(state)

    if (/Ready to (publish|update)$/.test(status.text)) {
      expect(action.enabled).toBe(true)
    }

    if (!action.enabled) {
      expect(status.text).not.toMatch(/Ready to/)
      // A published or sent status over a disabled button is legitimate in
      // exactly one shape: the reply is live and there is nothing newer to
      // send. Anything else would be claiming a state the button denies.
      if (
        status.text === "Reply published" ||
        status.text === "Sent to Google"
      ) {
        expect(action.settled).toBe(true)
      }
    }
  })
})

describe("replyStateFromRow", () => {
  function row(
    overrides: Partial<Parameters<typeof replyStateFromRow>[0]> = {}
  ) {
    return {
      workflowStatus: "new",
      draftBody: null,
      replyBody: null,
      replyStatus: null,
      verificationStatus: null,
      capabilities: {
        canPublish: true,
        canEdit: true,
        canRequestApproval: false,
      },
      ...overrides,
    }
  }

  it("carries the row's draft and verdict into the same input shape", () => {
    expect(
      replyStateFromRow(
        row({
          workflowStatus: "verified",
          draftBody: "Thanks!",
          verificationStatus: "pass",
        })
      )
    ).toMatchObject({
      drafts: [{ body: "Thanks!", verificationStatus: "pass" }],
      verification: { verdict: "pass", reasons: [] },
      isDirty: false,
    })
  })

  it("leaves the verification null for a verdict it does not recognise", () => {
    const state = replyStateFromRow(
      row({ draftBody: "Thanks!", verificationStatus: "pending" })
    )
    expect(state.verification).toBeNull()
    expect(state.drafts).toEqual([
      { body: "Thanks!", verificationStatus: "pending" },
    ])
  })

  it("has no drafts at all when the row carries no draft body", () => {
    expect(replyStateFromRow(row()).drafts).toEqual([])
  })

  // The two server-scoped approval queues are the only authoritative answer to
  // "who is this waiting on"; the aggregate Approval tab is not, so it has to
  // come back unknown rather than guessing.
  it.each([
    ["awaiting_my_approval", "me"],
    ["awaiting_others", "others"],
    ["approval", "unknown"],
    ["needs_reply", "unknown"],
    [undefined, "unknown"],
  ])("maps queue %s to approval scope %s", (queue, scope) => {
    expect(replyStateFromRow(row(), queue).approvalScope).toBe(scope)
  })

  it("gives a row in the aggregate queue the non-committal sentence", () => {
    expect(
      deriveReplyStatus(
        replyStateFromRow(
          row({ workflowStatus: "awaiting_approval" }),
          "approval"
        )
      ).text
    ).toBe("Waiting for approval")
  })

  it("gives the list row the same answer the detail pane would give", () => {
    expect(
      deriveReplyStatus(
        replyStateFromRow(
          row({
            workflowStatus: "verified",
            draftBody: "Thanks!",
            verificationStatus: "pass",
          })
        )
      ).short
    ).toBe("Ready to publish")
  })
})

/**
 * The ladder's order is itself a contract: the status must always name the
 * thing standing between the operator and the action on screen. These two are
 * the cases where a plausible order gets it wrong.
 */
describe("deriveReplyStatus — the ladder names what actually blocks the action", () => {
  it("keeps an approver on 'Approval required' while their edits are unsaved", () => {
    // `evaluateApproval` does not consider dirtiness, so Approve stays live.
    // Ordering `isDirty` above `awaiting_approval` would tell an approver to
    // save a draft with an enabled Approve button sitting underneath them.
    const state = input({
      workflowStatus: "awaiting_approval",
      drafts: [draft("Thanks for staying with us!", "pass")],
      isDirty: true,
      approvalScope: "me",
    })
    expect(deriveReplyStatus(state).text).toBe("Approval required")
    expect(derivePrimaryAction(state).enabled).toBe(true)
  })

  it("asks a failed publish to be saved first once it has been edited", () => {
    // Here dirtiness genuinely does block: `evaluatePublish` refuses until the
    // draft is saved, so "Publish failed" would be true but useless. The
    // failure keeps its own place in the exception block beneath the reply.
    const state = input({
      workflowStatus: "failed",
      reply: { body: "Thanks!", publishStatus: "failed" },
      drafts: [draft("Thanks so much!", "pass")],
      isDirty: true,
    })
    expect(deriveReplyStatus(state).text).toBe("Unsaved changes · Save draft")
    const action = derivePrimaryAction(state)
    expect(action.enabled).toBe(false)
    expect(action.reason).toBe("Save your draft before publishing.")
  })
})
