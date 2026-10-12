import { describe, expect, it } from "vitest"

import { localWallTime } from "@/lib/domain/publication-schedule"
import {
  liveOnceSchedule,
  occurrenceReasonText,
  scheduleActions,
  scheduleBadge,
  scheduleReasonText,
  usableSuggestion,
} from "@/lib/locations/schedule-display"

const manager = { manager: true, editor: true, enabled: true }
const once = {
  frequency: "once" as const,
  startDate: "2026-11-02",
  localTime: "09:00",
}

describe("schedule display (P08-R5)", () => {
  it("badges a missed slot as missed and offers only a new time or a cancel", () => {
    for (const reason of ["paused_when_due", "outside_dispatch_window"]) {
      const schedule = {
        status: "needs_review" as const,
        statusReason: reason,
        approvedBy: "u1",
      }
      expect(scheduleBadge(schedule)).toEqual({ label: "Missed", tone: "warn" })
      expect(scheduleActions(schedule, manager)).toEqual({
        review: false,
        pause: false,
        resume: null,
        change: "Choose a new time",
        cancel: true,
      })
      expect(scheduleReasonText(schedule)).toMatch(/nothing will publish late/)
    }
  })

  it("never offers resume for a paused schedule whose slot was missed", () => {
    expect(
      scheduleActions(
        { status: "paused", statusReason: "paused_when_due", approvedBy: "u1" },
        manager
      ).resume
    ).toBeNull()
  })

  it("badges blocked and needs-review distinctly", () => {
    expect(
      scheduleBadge({ status: "blocked", statusReason: "connection_changed" })
    ).toEqual({ label: "Blocked", tone: "bad" })
    expect(
      scheduleBadge({
        status: "needs_review",
        statusReason: "recurring_quarantined",
      })
    ).toEqual({ label: "Needs review", tone: "warn" })
    expect(
      scheduleActions(
        {
          status: "needs_review",
          statusReason: "slot_needs_new_time",
          approvedBy: null,
        },
        manager
      ).change
    ).toBe("Choose a new time")
    expect(
      scheduleActions(
        {
          status: "needs_review",
          statusReason: "recurring_quarantined",
          approvedBy: null,
        },
        manager
      ).change
    ).toBe("Change")
  })

  it("asks for approval when a paused schedule's post was edited", () => {
    const schedule = {
      status: "paused" as const,
      statusReason: "source_changed",
      approvedBy: null,
    }
    expect(scheduleActions(schedule, manager).resume).toBe(
      "Resume and request approval"
    )
    expect(scheduleReasonText(schedule)).toMatch(
      /Resume it to ask for approval/
    )
  })

  it("keeps only pause and cancel with the feature off, and nothing for ended rows", () => {
    const off = { ...manager, enabled: false }
    expect(
      scheduleActions(
        { status: "active", statusReason: null, approvedBy: "u1" },
        off
      )
    ).toEqual({
      review: false,
      pause: true,
      resume: null,
      change: null,
      cancel: true,
    })
    expect(
      scheduleActions(
        { status: "awaiting_approval", statusReason: null, approvedBy: null },
        off
      ).review
    ).toBe(false)
    expect(
      scheduleActions(
        { status: "completed", statusReason: null, approvedBy: "u1" },
        manager
      )
    ).toEqual({
      review: false,
      pause: false,
      resume: null,
      change: null,
      cancel: false,
    })
  })

  it("treats only open one-time schedules as holding their post", () => {
    expect(liveOnceSchedule({ status: "active", rule: once })).toBe(true)
    expect(liveOnceSchedule({ status: "needs_review", rule: once })).toBe(false)
    expect(liveOnceSchedule({ status: "cancelled", rule: once })).toBe(false)
  })

  it("explains occurrences that did not publish", () => {
    expect(
      occurrenceReasonText({
        status: "missed",
        statusReason: "paused_when_due",
      })
    ).toMatch(/Paused when due/)
    expect(
      occurrenceReasonText({
        status: "missed",
        statusReason: "outside_dispatch_window",
      })
    ).toMatch(/within 5 minutes/)
    expect(
      occurrenceReasonText({ status: "scheduled", statusReason: null })
    ).toBeNull()
  })

  it("reads an instant's wall time in a zone, across a clock change", () => {
    expect(localWallTime("2026-10-25T00:30:00Z", "Europe/London")).toEqual({
      date: "2026-10-25",
      time: "01:30",
    })
    expect(localWallTime("2026-10-25T01:30:00Z", "Europe/London")).toEqual({
      date: "2026-10-25",
      time: "01:30",
    })
    expect(localWallTime("2026-12-31T23:59:00Z", "Asia/Kolkata")).toEqual({
      date: "2027-01-01",
      time: "05:29",
    })
  })

  it("uses a suggested old time only while a one-time schedule can still take it, in the sheet's zone", () => {
    // 2026-07-01 12:00 UTC is 13:00 in London and 22:00 in Sydney.
    const openedAt = Date.parse("2026-07-01T12:00:00Z")
    const suggest = (startDate: string, localTime: string, zone: string) =>
      usableSuggestion({ startDate, localTime }, zone, openedAt)
    // Earlier the same local day: already passed.
    expect(suggest("2026-07-01", "09:00", "Europe/London")).toBeNull()
    // Inside the 5-minute lead.
    expect(suggest("2026-07-01", "13:03", "Europe/London")).toBeNull()
    expect(suggest("2026-07-01", "13:10", "Europe/London")).toEqual({
      startDate: "2026-07-01",
      localTime: "13:10",
    })
    // The UTC date is still 1 July, but in Sydney 2 July 01:00 is ahead and
    // 1 July 21:00 has passed.
    expect(suggest("2026-07-02", "01:00", "Australia/Sydney")).not.toBeNull()
    expect(suggest("2026-07-01", "21:00", "Australia/Sydney")).toBeNull()
    // Beyond the 90-day limit, or a time the clocks skip.
    expect(suggest("2026-12-01", "09:00", "Europe/London")).toBeNull()
    expect(suggest("2027-03-28", "01:30", "Europe/London")).toBeNull()
    expect(usableSuggestion(undefined, "Europe/London", openedAt)).toBeNull()
  })
})
