import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { PublicationCalendar } from "@/components/calendar/publication-calendar"

vi.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

const occurrence = (
  id: string,
  localDate: string,
  localTime: string,
  adjustment: "none" | "moved_forward" | "earlier_of_repeated",
  summary: string
) => ({
  id,
  scheduleId: "00000000-0000-4000-8000-000000000001",
  locationId: "00000000-0000-4000-8000-000000000002",
  locationName: "Old Crown",
  intendedAt: `${localDate}T00:30:00.000Z`,
  localDate,
  localTime,
  timezone: "Europe/London",
  adjustment,
  status: "scheduled",
  statusReason: null,
  postId: null,
  summary,
  topicType: "STANDARD",
})

const OCCURRENCES = [
  // Clocks go back in the UK on 25 October 2026: 01:30 happens twice.
  occurrence(
    "00000000-0000-4000-8000-0000000000a1",
    "2026-10-25",
    "01:30",
    "earlier_of_repeated",
    "Sunday roast"
  ),
  occurrence(
    "00000000-0000-4000-8000-0000000000a2",
    "2026-10-25",
    "12:00",
    "none",
    "Quiz night"
  ),
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"))
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/api/post-schedules/occurrences"))
        return jsonResponse({ occurrences: OCCURRENCES })
      if (url.includes("/api/clients"))
        return jsonResponse({ items: [], unassignedLocationCount: 0 })
      if (url.includes("/api/session"))
        return jsonResponse({ session: { role: "owner" } })
      return jsonResponse({ locations: [] })
    })
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("PublicationCalendar month grid", () => {
  it("fits all seven days without a sideways scroll", async () => {
    renderWithProviders(<PublicationCalendar />)
    const grid = await screen.findByRole("region", { name: "Calendar grid" })
    const table = within(grid).getByRole("table")
    // No fixed minimum width and no horizontal scroller hiding Fri–Sun.
    expect(table.className).not.toMatch(/min-w-/)
    expect(grid.className).not.toMatch(/overflow-x-auto/)
    expect(table.className).toContain("table-fixed")
    expect(table.className).toContain("w-full")
    const headers = within(table).getAllByRole("columnheader")
    expect(headers.map((header) => header.textContent)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ])
  })

  it("opens a compact day's full list from a keyboard-reachable button", async () => {
    renderWithProviders(<PublicationCalendar />)
    const day = await screen.findByRole("button", {
      name: "Sunday 25 October, 2 publications",
    })
    expect(day).toHaveAttribute("aria-pressed", "false")
    day.focus()
    await userEvent.keyboard("{Enter}")
    expect(day).toHaveAttribute("aria-pressed", "true")

    const detail = screen.getByRole("region", {
      name: "Publications on Sunday 25 October",
    })
    expect(within(detail).getByText(/Sunday roast/)).toBeInTheDocument()
    expect(within(detail).getByText(/Quiz night/)).toBeInTheDocument()
    // The repeated autumn hour did not move; say so accurately.
    expect(
      within(detail).getByText(
        /Clocks go back: this time happens twice that day, so it runs once, at the earlier of the two/
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/moved by a clock change/)
    ).not.toBeInTheDocument()
  })

  it("uses the accurate clock-change wording in the agenda", async () => {
    renderWithProviders(<PublicationCalendar />)
    await screen.findByRole("region", { name: "Calendar grid" })
    await userEvent.click(screen.getByRole("tab", { name: "Agenda" }))
    const agenda = await screen.findByRole("list", {
      name: "Scheduled publications",
    })
    expect(within(agenda).getByText(/Clocks go back/)).toBeInTheDocument()
    expect(
      screen.queryByText(/moved by a clock change/)
    ).not.toBeInTheDocument()
  })
})
