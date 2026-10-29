import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PostSchedules } from "@/components/locations/posts/post-schedules"
import {
  SchedulePostSheet,
  scheduleProblem,
} from "@/components/locations/posts/schedule-post-sheet"
import type { PublicationSchedule } from "@/lib/contracts/publication-schedules"
import {
  eventOffsetsSchema,
  scheduleRuleSchema,
} from "@/lib/domain/publication-schedule"
import { renderWithProviders } from "../helpers/render"

const LOCATION = "00000000-0000-4000-8000-0000000000aa"
const DRAFT = "00000000-0000-4000-8000-0000000000b1"
const USER = "00000000-0000-4000-8000-0000000000d1"

let n = 0
function schedule(
  overrides: Partial<PublicationSchedule> = {}
): PublicationSchedule {
  n += 1
  return {
    id: `00000000-0000-4000-8000-00000000f${String(n).padStart(3, "0")}`,
    locationId: LOCATION,
    locationName: "Old Crown",
    status: "active",
    statusReason: null,
    revision: 1,
    payloadHash: "a".repeat(64),
    rule: { frequency: "once", startDate: "2026-10-20", localTime: "09:00" },
    timezone: "Europe/London",
    offsetMinutes: 60,
    eventOffsets: null,
    template: { topicType: "STANDARD", summary: "Sunday roast is back" },
    sourcePostId: DRAFT,
    sourceContentRevision: 1,
    requestedBy: USER,
    approvedBy: USER,
    approvedAt: "2026-10-12T10:00:00.000Z",
    requiresSecondApprover: false,
    canApprove: false,
    preview: {
      total: 1,
      first: [],
      skippedDates: [],
      adjusted: 0,
      problem: null,
    },
    counts: {},
    ...overrides,
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

let schedules: PublicationSchedule[] = []
const calls: Array<{ method: string; url: string; body: unknown }> = []

beforeEach(() => {
  schedules = []
  calls.length = 0
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? "GET"
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ method, url, body })
      if (url.includes("/api/session"))
        return json({
          session: {
            userId: USER,
            organisationId: "org",
            organisationName: "Old Crown",
            displayName: "Owner",
            email: "owner@example.test",
            role: "owner",
            canPublish: true,
            workspaceMode: "business",
          },
        })
      if (url.includes("/post-schedules/") && method === "PATCH") {
        const id = url.split("/").at(-1)
        const status = {
          pause: "paused",
          resume: "active",
          cancel: "cancelled",
        }[
          (body as { action: "pause" | "resume" | "cancel" }).action
        ] as PublicationSchedule["status"]
        schedules = schedules.map((row) =>
          row.id === id ? { ...row, status } : row
        )
        return json({ schedule: schedules.find((row) => row.id === id) })
      }
      if (url.includes("/post-schedules") && method === "POST")
        return json(
          { schedule: schedule({ status: "awaiting_approval" }) },
          201
        )
      if (url.includes("/post-schedules")) return json({ schedules })
      return json({}, 404)
    })
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const issue = (
  result: { success: boolean; error?: { issues: unknown[] } },
  index = 0
) => {
  expect(result.success).toBe(false)
  return result.error?.issues[index] as Parameters<typeof scheduleProblem>[0]
}

describe("schedule validation in plain words (WCAG 3.3.1, 3.3.3)", () => {
  const start = { startDate: "2026-10-20", localTime: "09:00" }

  it("says a cleared date or number field plainly, at its field", () => {
    expect(
      scheduleProblem(
        issue(
          scheduleRuleSchema.safeParse({
            frequency: "once",
            ...start,
            startDate: "",
          })
        )
      )
    ).toEqual({ message: "Enter a date.", field: "startDate" })
    expect(
      scheduleProblem(
        issue(
          scheduleRuleSchema.safeParse({
            frequency: "daily",
            ...start,
            end: { type: "count", count: 0 },
          })
        )
      )
    ).toEqual({
      message: "Enter how many times, from 1 to 366.",
      field: "count",
    })
    expect(
      scheduleProblem(
        issue(
          scheduleRuleSchema.safeParse({
            frequency: "monthly",
            ...start,
            end: { type: "count", count: 4 },
            dayOfMonth: 0,
          })
        )
      )
    ).toEqual({ message: "Enter a day from 1 to 31.", field: "dayOfMonth" })
    expect(
      scheduleProblem(
        issue(
          scheduleRuleSchema.safeParse({
            frequency: "weekly",
            ...start,
            end: { type: "count", count: 4 },
            weekdays: [],
          })
        )
      )
    ).toEqual({ message: "Choose at least one day.", field: "weekdays" })
    expect(
      scheduleProblem(
        issue(
          scheduleRuleSchema.safeParse({
            frequency: "daily",
            ...start,
            end: { type: "date", date: "" },
          })
        )
      )
    ).toEqual({ message: "Enter a last date.", field: "endDate" })
    expect(
      scheduleProblem(
        issue(eventOffsetsSchema.safeParse({ startDays: 0, endDays: 400 }))
      )
    ).toEqual({ message: "Enter days from 0 to 365.", field: "endDays" })
  })

  it("keeps the schedule rules' own messages", () => {
    expect(
      scheduleProblem(
        issue(
          scheduleRuleSchema.safeParse({
            frequency: "once",
            ...start,
            startDate: "2026-02-30",
          })
        )
      )
    ).toEqual({ message: "Enter a real date.", field: "startDate" })
    expect(
      scheduleProblem(
        issue(
          scheduleRuleSchema.safeParse({
            frequency: "daily",
            ...start,
            end: { type: "date", date: "2026-10-01" },
          })
        )
      )
    ).toEqual({
      message: "The end date is before the start date.",
      field: "endDate",
    })
    expect(
      scheduleProblem(
        issue(eventOffsetsSchema.safeParse({ startDays: 3, endDays: 1 }))
      ).message
    ).toBe("The event cannot end before it starts.")
    expect(scheduleProblem(undefined).message).toBe("Check the schedule.")
  })
})

describe("the schedule sheet", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-14T10:00:00Z"))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function renderSheet(recurring: boolean) {
    renderWithProviders(
      <SchedulePostSheet
        locationId={LOCATION}
        timezone="Europe/London"
        recurring={recurring}
        post={{ id: DRAFT, topicType: "STANDARD", summary: "Sunday roast" }}
      />
    )
    return screen.getByRole("button", {
      name: "Schedule publication: Sunday roast",
    })
  }

  it("says a cleared date at the field and in the preview, never in zod's words", async () => {
    const user = userEvent.setup()
    await user.click(renderSheet(true))
    const sheet = await screen.findByRole("dialog", {
      name: "Schedule publication",
    })
    const date = within(sheet).getByLabelText("Date")
    await user.clear(date)
    expect(within(sheet).getByRole("alert")).toHaveTextContent(
      /^Enter a date\.$/
    )
    expect(date).toHaveAccessibleDescription("Enter a date.")
    expect(date).toHaveAttribute("aria-invalid", "true")
    expect(sheet).not.toHaveTextContent(/Invalid string|Too small|expected/)
    expect(
      within(sheet).getByRole("button", {
        name: "Submit schedule for approval",
      })
    ).toBeDisabled()
  })

  it("asks for at least one weekday when every day is unticked", async () => {
    const user = userEvent.setup()
    await user.click(renderSheet(true))
    const sheet = await screen.findByRole("dialog", {
      name: "Schedule publication",
    })
    await user.click(within(sheet).getByRole("radio", { name: "Weekly" }))
    await user.click(within(sheet).getByRole("checkbox", { name: "Mon" }))
    expect(within(sheet).getByRole("alert")).toHaveTextContent(
      "Choose at least one day."
    )
    expect(sheet).not.toHaveTextContent(/Too small/)
  })

  it("says the schedule was sent for approval once the server has saved it", async () => {
    const user = userEvent.setup()
    await user.click(renderSheet(false))
    const sheet = await screen.findByRole("dialog", {
      name: "Schedule publication",
    })
    await user.click(
      within(sheet).getByRole("button", {
        name: "Submit schedule for approval",
      })
    )
    expect(
      await screen.findByText("Schedule sent for approval")
    ).toBeInTheDocument()
    expect(
      calls.filter(
        (call) => call.method === "POST" && call.url.includes("/post-schedules")
      )
    ).toHaveLength(1)
  })
})

describe("the schedules list", () => {
  function renderList(enabled = true) {
    return renderWithProviders(
      <PostSchedules
        locationId={LOCATION}
        timezone="Europe/London"
        enabled={enabled}
        recurring={false}
      />
    )
  }
  const patches = () => calls.filter((call) => call.method === "PATCH")

  it("asks before cancelling, and Keep schedule changes nothing", async () => {
    schedules = [schedule()]
    renderList()
    const user = userEvent.setup()
    const region = await screen.findByRole("region", {
      name: "Publication schedules",
    })
    await user.click(
      await within(region).findByRole("button", { name: "Cancel schedule" })
    )
    const confirm = await screen.findByRole("alertdialog", {
      name: "Cancel this schedule?",
    })
    expect(confirm).toHaveTextContent(/can’t be restarted/)
    await user.click(
      within(confirm).getByRole("button", { name: "Keep schedule" })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(patches()).toHaveLength(0)
    expect(within(region).getByText("Active")).toBeInTheDocument()
  })

  it("cancels on confirmation and says so after the server has", async () => {
    const row = schedule()
    schedules = [row]
    renderList()
    const user = userEvent.setup()
    const region = await screen.findByRole("region", {
      name: "Publication schedules",
    })
    await user.click(
      await within(region).findByRole("button", { name: "Cancel schedule" })
    )
    const confirm = await screen.findByRole("alertdialog", {
      name: "Cancel this schedule?",
    })
    await user.click(
      within(confirm).getByRole("button", { name: "Cancel schedule" })
    )
    expect(await screen.findByText("Schedule cancelled")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(patches()).toEqual([
      {
        method: "PATCH",
        url: `/api/locations/${LOCATION}/post-schedules/${row.id}`,
        body: { action: "cancel" },
      },
    ])
  })

  it("pauses in one tap", async () => {
    schedules = [schedule()]
    renderList()
    const user = userEvent.setup()
    const region = await screen.findByRole("region", {
      name: "Publication schedules",
    })
    await user.click(
      await within(region).findByRole("button", { name: "Pause" })
    )
    expect(await screen.findByText("Schedule paused")).toBeInTheDocument()
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(patches()).toHaveLength(1)
    expect(patches()[0].body).toEqual({ action: "pause" })
  })

  it("says scheduling is off when it is, offering only pause and cancel", async () => {
    schedules = [schedule()]
    renderList(false)
    const region = await screen.findByRole("region", {
      name: "Publication schedules",
    })
    expect(
      within(region).getByText(
        "Scheduled publishing is switched off for this workspace, so nothing here publishes. You can still pause or cancel these schedules."
      )
    ).toBeInTheDocument()
    expect(region).not.toHaveTextContent(/Approved schedules publish/)
    const buttons = within(region)
      .getAllByRole("button")
      .map((button) => button.textContent)
    expect(buttons).toEqual(["Pause", "Cancel schedule"])
  })

  it("reads rows in words: zone, counts and a post with no text", async () => {
    schedules = [
      schedule({
        template: { topicType: "EVENT", summary: "" },
        counts: { scheduled: 1, ambiguous: 1, rejected: 2 },
      }),
    ]
    renderList()
    const region = await screen.findByRole("region", {
      name: "Publication schedules",
    })
    expect(await within(region).findByText("Event")).toBeInTheDocument()
    expect(
      within(region).getByText(
        "Once on 2026-10-20 at 09:00 (UK time, UTC+01:00) · 1 planned · 1 being checked · 2 not accepted"
      )
    ).toBeInTheDocument()
    expect(region).not.toHaveTextContent(/Europe\/London|EVENT/)
  })

  it("lists the approval's publications by day, in the zone's name", async () => {
    schedules = [
      schedule({
        status: "awaiting_approval",
        approvedBy: null,
        approvedAt: null,
        canApprove: true,
        preview: {
          total: 1,
          first: [
            {
              intendedAt: "2026-10-20T08:00:00.000Z",
              localDate: "2026-10-20",
              localTime: "09:00",
              adjustment: "none",
            },
          ],
          skippedDates: [],
          adjusted: 0,
          problem: null,
        },
      }),
    ]
    renderList()
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole("button", { name: "Review schedule" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "Approve publication schedule",
    })
    expect(
      within(dialog).getByText("Tue 20 Oct, 09:00 UK time")
    ).toBeInTheDocument()
    expect(dialog).not.toHaveTextContent(/Europe\/London/)
  })

  it("points an empty list at the menu item that exists", async () => {
    renderList()
    expect(
      await screen.findByText(
        "No schedules yet. Choose Schedule publication from a post’s More actions menu."
      )
    ).toBeInTheDocument()
  })
})
