import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { childPill } from "@/components/bulk/bulk-operation-view"
import { OCCURRENCE_STATUS } from "@/components/calendar/calendar-grid"
import { ActivityTimeline } from "@/components/inbox/activity-timeline"
import { ReviewMetadata } from "@/components/inbox/detail/review-metadata"
import { generatedToast } from "@/components/inbox/reply-composer"
import { checkOutcomeTitle } from "@/components/locations/posts-action-bar"
import { connectionStatus } from "@/components/settings/connection-card"
import { OUTCOME_VISUAL } from "@/components/ui/operation-outcome"
import type { PostsState } from "@/lib/api/location-posts"
import type { BulkChild } from "@/lib/contracts/bulk-listings"
import type { ConnectionSummary } from "@/lib/api/connections"
import type { ReviewDetail } from "@/lib/contracts/reviews"
import {
  describeOutcome,
  NOTHING_TO_SEND_TITLE,
  OUTCOME_PRESENTATION,
  statusText,
} from "@/lib/editors/outcome"
import {
  publishOutcome,
  sentNothingToGoogle,
  type PublishStepResult,
} from "@/lib/editors/use-publish-flow"
import { deriveReplyStatus } from "@/lib/inbox/reply-state"
import { activityMaskLabels } from "@/lib/listings/activity-outcome"
import { matchesPostFilter } from "@/lib/locations/post-display"
import { scheduleBadge } from "@/lib/locations/schedule-display"

// DIRECTION §6.3: each place that claimed more than the backend knew, with a
// test that it no longer says "published" or "live" before Google confirms.
const PREMATURE = /published|\blive\b|on google/i

describe("DIRECTION §6.3 vocabulary fixes", () => {
  it("#1 calls Google taking a reply sent, not published", () => {
    render(
      <ActivityTimeline
        timezone="Europe/London"
        timeline={[
          {
            action: "review.reply.published",
            createdAt: "2026-11-03T09:00:00.000Z",
            actorName: "Priya",
            metadataSummary: null,
          },
        ]}
      />
    )
    expect(screen.getByText("Reply sent to Google")).toBeInTheDocument()
    expect(screen.queryByText(/Reply published/)).toBeNull()

    render(
      <ReviewMetadata
        open
        onOpenChange={() => {}}
        review={
          {
            createTime: "2026-11-01T09:00:00.000Z",
            timezone: "Europe/London",
            locationName: "Riverside",
            verified: true,
            drafts: [],
            timeline: [
              {
                action: "review.reply.published",
                createdAt: "2026-11-03T09:00:00.000Z",
                actorName: "Priya",
                metadataSummary: null,
              },
            ],
          } as unknown as ReviewDetail["review"]
        }
      />
    )
    expect(screen.getByText("Sent to Google by")).toBeInTheDocument()
    expect(screen.queryByText("Published by")).toBeNull()
  })

  it("#2 words Google's refusal and the approver's send-back apart", () => {
    const status = deriveReplyStatus({
      workflowStatus: "rejected",
      capabilities: {
        canPublish: true,
        canEdit: true,
        canRequestApproval: false,
      },
      reply: null,
      drafts: [{ body: "Thanks", verificationStatus: "pass" }],
      verification: { verdict: "pass", reasons: [] },
      isDirty: false,
    })
    expect(status.text).toBe("Rejected by Google")
    expect(status.text).not.toMatch(/sent back/i)
    expect(describeOutcome("changes").label).toBe("Sent back")
  })

  it("#3 titles the generate toast by the verdict", () => {
    expect(generatedToast("pass")).toMatchObject({
      title: "Reply ready",
      type: "success",
    })
    expect(generatedToast("fail")).toMatchObject({
      title: "Reply written, needs a correction",
      type: "warning",
    })
    expect(generatedToast(null)).toMatchObject({
      title: "Reply written, not checked yet",
      type: "info",
    })
    expect(generatedToast("pending").title).not.toBe("Reply ready")
  })

  it("#4 says a bulk listing is On Google only once it is confirmed", () => {
    const child = (
      over: Partial<BulkChild>
    ): Pick<BulkChild, "status" | "confirmationState" | "resultCode"> => ({
      status: "succeeded",
      confirmationState: "unrecorded",
      resultCode: null,
      ...over,
    })
    expect(childPill(child({}))).toEqual({
      label: "Sent, waiting for Google",
      tone: "info",
    })
    expect(childPill(child({ confirmationState: "unresolved" }))).toEqual({
      label: "Not confirmed: check Google",
      tone: "warn",
    })
    expect(childPill(child({ resultCode: "submitted_for_approval" }))).toEqual({
      label: "Awaiting approval",
      tone: "warn",
    })
    expect(childPill(child({ confirmationState: "confirmed" }))).toEqual({
      label: "On Google",
      tone: "ok",
    })
    expect(childPill(child({}))).not.toMatchObject({ label: "Confirmed" })
  })

  it("#5 calls a scheduled run that settled published sent, not published", () => {
    expect(OCCURRENCE_STATUS.published.label).toBe("Sent, waiting for Google")
    expect(OCCURRENCE_STATUS.published.tone).not.toBe("healthy")
    for (const { label } of Object.values(OCCURRENCE_STATUS))
      expect(label).not.toMatch(/published/i)
  })

  it("#6 Check Google says on Google only for a post Google shows live", () => {
    const state = (googleState: string | null) =>
      ({
        reconciliationError: null,
        posts: [{ id: "p1", status: "published", googleState }],
      }) as unknown as PostsState
    expect(checkOutcomeTitle(state("LIVE"), "p1")).toBe(
      "This post is on Google."
    )
    expect(checkOutcomeTitle(state("PROCESSING"), "p1")).not.toMatch(PREMATURE)
    expect(checkOutcomeTitle(state(null), "p1")).not.toMatch(PREMATURE)
  })

  it("#7 keeps posts still sending out of the On Google filter", () => {
    expect(
      matchesPostFilter(
        { status: "publishing", googleState: null },
        "published"
      )
    ).toBe(false)
    expect(
      matchesPostFilter(
        { status: "published", googleState: "PROCESSING" },
        "published"
      )
    ).toBe(false)
    expect(
      matchesPostFilter(
        { status: "published", googleState: "LIVE" },
        "published"
      )
    ).toBe(true)
  })

  it("#8 draws awaiting approval in one amber tone", () => {
    expect(describeOutcome("awaiting_approval").tone).toBe("attention")
    expect(OUTCOME_VISUAL.awaiting_approval.mark).toContain("warning")
    expect(
      scheduleBadge({ status: "awaiting_approval", statusReason: null }).tone
    ).toBe("warn")
  })

  it("#9 gives uncertain one name", () => {
    expect(describeOutcome("uncertain").label).toBe(
      "Not confirmed: check Google"
    )
    expect(OCCURRENCE_STATUS.ambiguous.label).toBe(
      "Not confirmed: check Google"
    )
  })

  it("#10 never toasts a confirmation for a publish that sent nothing", () => {
    const noop: PublishStepResult[] = [
      { key: "save", label: "Save", status: "done", kind: "local" },
      {
        key: "hours",
        label: "Hours",
        status: "done",
        kind: "google",
        noop: true,
      },
    ] as PublishStepResult[]
    expect(sentNothingToGoogle(noop)).toBe(true)
    expect(NOTHING_TO_SEND_TITLE).toBe(
      "Nothing to send. Already matches Google"
    )
    const sent = [
      { ...noop[1], noop: false, verified: true },
    ] as PublishStepResult[]
    expect(sentNothingToGoogle(sent)).toBe(false)
    expect(publishOutcome(sent)).toBe("confirmed_applied")
  })

  it("#11 words a scheduled retry without claiming it is sending forever", () => {
    // The retry time is not on the wire yet; without it the words still
    // say a retry is coming rather than "Publishing" indefinitely.
    const { label, title, tone } = OUTCOME_PRESENTATION.retrying
    expect(statusText(label, { time: "10:42" })).toBe("Will retry at 10:42")
    expect(statusText(title)).toBe("Google is busy. We’ll retry later.")
    expect(tone).toBe("pending")
    expect(`${label} ${title}`).not.toMatch(PREMATURE)
  })

  it("#12 never shows a connection's raw status token", () => {
    const connection = (status: string) =>
      ({ status, reconnectRequired: false }) as ConnectionSummary
    expect(connectionStatus(connection("error")).label).toBe(
      "Connection problem"
    )
    expect(connectionStatus(connection("weird_state")).label).toBe(
      "Status unknown"
    )
  })

  it("#13 names field masks in people's words", () => {
    expect(activityMaskLabels(["regularHours"]).join(", ")).not.toMatch(
      /regularHours/
    )
  })
})
