import { describe, expect, it } from "vitest"

import { operationalEventSchema } from "@/lib/contracts/operational-events"
import { SCHEDULE_REASON } from "@/lib/locations/schedule-display"
import {
  renderIncidentEmail,
  renderPlatformEmail,
} from "@/lib/server/notifications/messages"
import {
  SCHEDULED_POST_OVERDUE_AFTER_SECONDS,
  SCHEDULED_POST_STUCK_AFTER_SECONDS,
  scheduledPostFindings,
  type ScheduledPostHealthRow,
} from "@/lib/server/ops-liveness"

const ORG_A = "11111111-1111-4111-8111-111111111111"
const ORG_B = "22222222-2222-4222-8222-222222222222"
const LOCATION = "33333333-3333-4333-8333-333333333333"
const ID = "44444444-4444-4444-8444-444444444444"
const APP = "https://app.nabapresence.test"

const row = (
  organisationId: string,
  overrides: Partial<ScheduledPostHealthRow> = {}
): ScheduledPostHealthRow => ({
  organisationId,
  stuckPublishing: 0,
  oldestStartedAt: null,
  overdueScheduled: 0,
  oldestDeadlineAt: null,
  ...overrides,
})

describe("scheduled post health findings (P08-R6)", () => {
  const started = new Date("2026-10-12T08:00:00.000Z")
  const deadline = new Date("2026-10-12T08:05:00.000Z")

  it("reports a stuck publish and an overdue slot per organisation, with counts and instants only", () => {
    const findings = scheduledPostFindings(
      [
        row(ORG_A, { stuckPublishing: 2, oldestStartedAt: started }),
        row(ORG_B, { overdueScheduled: 3, oldestDeadlineAt: deadline }),
      ],
      false
    )
    expect(findings).toEqual([
      {
        kind: "scheduled_post_stuck",
        subject: ORG_A,
        details: {
          occurrences: 2,
          oldestStartedAt: started.toISOString(),
          stuckAfterSeconds: SCHEDULED_POST_STUCK_AFTER_SECONDS,
        },
      },
      {
        kind: "scheduled_post_overdue",
        subject: ORG_B,
        details: {
          occurrences: 3,
          oldestDeadlineAt: deadline.toISOString(),
          overdueAfterSeconds: SCHEDULED_POST_OVERDUE_AFTER_SECONDS,
        },
      },
    ])
  })

  it("holds a stuck publish while the scheduled post path is paused, but never an overdue slot", () => {
    const findings = scheduledPostFindings(
      [
        row(ORG_A, {
          stuckPublishing: 1,
          oldestStartedAt: started,
          overdueScheduled: 1,
          oldestDeadlineAt: deadline,
        }),
      ],
      true
    )
    expect(findings.map((finding) => finding.kind)).toEqual([
      "scheduled_post_overdue",
    ])
  })

  it("reports nothing for an organisation with neither", () => {
    expect(scheduledPostFindings([row(ORG_A)], false)).toEqual([])
  })

  it("keeps the thresholds past the claim's lease and the sweep's deadline", () => {
    // The jobs tick's lease is its 45 s budget plus a minute.
    expect(SCHEDULED_POST_STUCK_AFTER_SECONDS).toBeGreaterThan(45 + 60)
    expect(SCHEDULED_POST_OVERDUE_AFTER_SECONDS).toBe(60)
  })

  it("emails operators the organisation and counts, never post content", () => {
    const stuck = renderPlatformEmail("scheduled_post_stuck", ORG_A, {
      occurrences: 2,
      oldestStartedAt: started.toISOString(),
    })
    expect(stuck.subject).toBe(
      "NabaPresence: a scheduled post is stuck publishing"
    )
    expect(stuck.text).toContain(ORG_A)
    expect(stuck.text).toContain("none is sent again")
    expect(stuck.text).toContain('"Scheduled post alerts"')
    const overdue = renderPlatformEmail("scheduled_post_overdue", ORG_B, {
      occurrences: 3,
      oldestDeadlineAt: deadline.toISOString(),
    })
    expect(overdue.subject).toBe(
      "NabaPresence: scheduled posts were not recorded as missed"
    )
    expect(overdue.text).toContain("will publish late")
    expect(overdue.text).toContain(deadline.toISOString())
  })
})

describe("scheduled post event reasons and copy (P08-R6)", () => {
  const base = {
    version: 1,
    organisationId: ORG_A,
    target: { type: "location", locationId: LOCATION },
    occurredAt: "2026-10-12T08:00:00Z",
    source: { type: "schedule_occurrence", id: ID, scheduleId: ID },
  }
  const blocked = (reason: string) =>
    operationalEventSchema.safeParse({
      ...base,
      kind: "schedule_blocked",
      reason,
    })
  const missed = (reason: string) =>
    operationalEventSchema.safeParse({
      ...base,
      kind: "schedule_missed",
      dueAt: base.occurredAt,
      reason,
    })

  it("accepts the strict dispatch and source-draft reasons", () => {
    expect(missed("outside_dispatch_window").success).toBe(true)
    expect(missed("paused_when_due").success).toBe(true)
    for (const reason of [
      "prior_occurrence_unverified",
      "source_changed",
      "source_superseded",
      "connection_changed",
    ])
      expect(blocked(reason).success, reason).toBe(true)
    expect(blocked("raw provider text").success).toBe(false)
  })

  it("has wording for every reason an event can carry, except the pre-R3 grace period", () => {
    const options = (kind: "schedule_blocked" | "schedule_missed") => {
      const schema = operationalEventSchema.options.find(
        (option) => option.shape.kind.value === kind
      )!
      return (
        schema.shape as unknown as { reason: { options: readonly string[] } }
      ).reason.options
    }
    const reasons = [
      ...options("schedule_blocked"),
      ...options("schedule_missed"),
    ].filter((reason) => reason !== "outside_grace_period")
    for (const reason of reasons)
      expect(SCHEDULE_REASON[reason], reason).toEqual(expect.any(String))
  })

  it("says in the email why the schedule stopped", () => {
    const paused = renderIncidentEmail(
      "schedule_missed",
      { title: "The Crown", locationId: LOCATION, reason: "paused_when_due" },
      APP
    )
    expect(paused.text).toContain("will not publish late")
    expect(paused.text).toContain(SCHEDULE_REASON.paused_when_due)
    const edited = renderIncidentEmail(
      "schedule_blocked",
      { title: "The Crown", locationId: LOCATION, reason: "source_changed" },
      APP
    )
    expect(edited.text).toContain(SCHEDULE_REASON.source_changed)
    // An unknown or inherited key adds nothing.
    for (const reason of ["constructor", "something_new", 7]) {
      const plain = renderIncidentEmail(
        "schedule_blocked",
        { title: "The Crown", locationId: LOCATION, reason },
        APP
      )
      expect(plain.text.split("\n")[1]).toMatch(/^Open: /)
    }
  })
})
