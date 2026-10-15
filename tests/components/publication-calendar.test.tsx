import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { PublicationCalendar } from "@/components/calendar/publication-calendar"
import {
  periodHeading,
  todayIn,
  utcDay,
  windowFor,
} from "@/components/calendar/calendar-dates"

// A working address bar: router.replace rewrites the search params the
// component reads, so URL state round-trips like it does in the browser.
const nav = vi.hoisted(() => {
  let search = ""
  const listeners = new Set<() => void>()
  return {
    get search() {
      return search
    },
    set(next: string) {
      search = next
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    replace: vi.fn(),
  }
})
vi.mock("next/navigation", async () => {
  const React = await import("react")
  return {
    usePathname: () => "/calendar",
    useRouter: () => ({
      push: vi.fn(),
      replace: nav.replace,
      refresh: vi.fn(),
    }),
    useSearchParams: () =>
      new URLSearchParams(
        React.useSyncExternalStore(
          nav.subscribe,
          () => nav.search,
          () => nav.search
        )
      ),
  }
})

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
  deadlineAt: `${localDate}T00:35:00.000Z`,
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
  nav.set("")
  nav.replace.mockReset()
  nav.replace.mockImplementation((url: string) =>
    nav.set(url.split("?")[1] ?? "")
  )
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
    // Beside the grid on a wider screen: focus lands on the day's heading.
    await waitFor(() =>
      expect(
        within(detail).getByRole("heading", { name: "Sunday 25 October" })
      ).toHaveFocus()
    )
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

describe("PublicationCalendar with scheduling switched off", () => {
  it("says the feature is off instead of a load failure to retry", async () => {
    const calls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.includes("/api/post-schedules/occurrences")) {
          calls.push(url)
          return new Response(
            JSON.stringify({
              error: "post_scheduling_unavailable",
              message:
                "Scheduled publishing is not switched on for this workspace.",
            }),
            { status: 404, headers: { "content-type": "application/json" } }
          )
        }
        if (url.includes("/api/clients"))
          return jsonResponse({ items: [], unassignedLocationCount: 0 })
        if (url.includes("/api/session"))
          return jsonResponse({ session: { role: "owner" } })
        return jsonResponse({ locations: [] })
      })
    )
    renderWithProviders(<PublicationCalendar />)
    expect(
      await screen.findByText(
        /Scheduled publishing is not switched on for this workspace\./
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Scheduled publications could not be loaded")
    ).not.toBeInTheDocument()
    // One answer, then no live controls and no further requests.
    expect(
      screen.queryByRole("button", { name: /Previous|Next|Today/ })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    nav.set("view=week&date=2026-12-01")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toHaveLength(1)
  })

  it("asks nothing when the page already knows scheduling is off", async () => {
    const fetchSpy = vi.mocked(fetch)
    renderWithProviders(<PublicationCalendar scheduling={false} />)
    expect(
      screen.getByRole("heading", { name: "Scheduled publishing is off" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    expect(screen.queryByText("Client")).not.toBeInTheDocument()
    // No description of a calendar that is not there, and a way out.
    expect(
      screen.queryByText(/Scheduled post publications across the listings/)
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Go to Listings" })
    ).toHaveAttribute("href", "/listings")
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(
      fetchSpy.mock.calls.filter(([input]) =>
        String(input).includes("/api/post-schedules/occurrences")
      )
    ).toHaveLength(0)
  })

  // P08-R5: a run that did not publish says why, and that it is not retried.
  it("says why a missed run did not publish", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.includes("/api/post-schedules/occurrences"))
          return jsonResponse({
            occurrences: [
              {
                ...OCCURRENCES[1],
                status: "missed",
                statusReason: "paused_when_due",
              },
            ],
          })
        if (url.includes("/api/clients"))
          return jsonResponse({ items: [], unassignedLocationCount: 0 })
        if (url.includes("/api/session"))
          return jsonResponse({ session: { role: "owner" } })
        return jsonResponse({ locations: [] })
      })
    )
    renderWithProviders(<PublicationCalendar />)
    await screen.findByRole("region", { name: "Calendar grid" })
    await userEvent.click(screen.getByRole("tab", { name: "Agenda" }))
    const agenda = await screen.findByRole("list", {
      name: "Scheduled publications",
    })
    expect(within(agenda).getByText("Missed")).toBeInTheDocument()
    expect(
      within(agenda).getByText(
        /Paused when due: nothing published\. Choose a new time on the listing\./
      )
    ).toBeInTheDocument()
  })
})

describe("PublicationCalendar address state", () => {
  it("keeps view, period and picked day in the URL and restores them", async () => {
    const first = renderWithProviders(<PublicationCalendar />)
    expect(
      await screen.findByRole("heading", { name: "October 2026" })
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Next month" }))
    expect(nav.replace).toHaveBeenLastCalledWith("/calendar?date=2026-11-01", {
      scroll: false,
    })
    expect(
      screen.getByRole("heading", { name: "November 2026" })
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole("tab", { name: "Week" }))
    expect(nav.search).toBe("date=2026-11-01&view=week")
    // Today deletes the default date; the view stays.
    await userEvent.click(screen.getByRole("button", { name: "Today" }))
    expect(nav.search).toBe("view=week")
    await userEvent.click(screen.getByRole("tab", { name: "Month" }))
    expect(nav.search).toBe("")

    const day = await screen.findByRole("button", {
      name: "Sunday 25 October, 2 publications",
    })
    await userEvent.click(day)
    expect(nav.search).toBe("day=2026-10-25")
    first.unmount()

    // Back to the page: the address alone restores the picked day.
    renderWithProviders(<PublicationCalendar />)
    expect(
      await screen.findByRole("region", {
        name: "Publications on Sunday 25 October",
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Sunday 25 October, 2 publications" })
    ).toHaveAttribute("aria-pressed", "true")
  })

  it("titles a week as a human date range, not two ISO dates", async () => {
    nav.set("view=week&date=2026-10-14")
    renderWithProviders(<PublicationCalendar />)
    const heading = await screen.findByRole("heading", { level: 2 })
    expect(heading.textContent).toMatch(/^12\s?–\s?18 Oct 2026$/)
    expect(
      periodHeading(
        "week",
        utcDay("2026-09-30"),
        windowFor("week", utcDay("2026-09-30"))
      )
    ).toMatch(/^28 Sept\s?–\s?4 Oct 2026$/)
  })
})

describe("PublicationCalendar today marker", () => {
  it("marks today in the organisation's timezone, not UTC's", async () => {
    // 20:00 UTC on 14 October is already 09:00 on the 15th in Auckland.
    vi.setSystemTime(new Date("2026-10-14T20:00:00Z"))
    expect(todayIn("Pacific/Auckland", new Date())).toBe("2026-10-15")
    renderWithProviders(<PublicationCalendar timeZone="Pacific/Auckland" />)
    await screen.findByRole("region", { name: "Calendar grid" })
    const current = document.querySelectorAll('[aria-current="date"]')
    expect(current).toHaveLength(1)
    expect(current[0]!.querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-10-15"
    )
  })
})

describe("PublicationCalendar on a phone", () => {
  it("opens the picked day in a bottom sheet", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    )
    renderWithProviders(<PublicationCalendar />)
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Sunday 25 October, 2 publications",
      })
    )
    const sheet = await screen.findByRole("dialog")
    expect(
      within(sheet).getByRole("heading", { name: "Sunday 25 October" })
    ).toBeInTheDocument()
    expect(within(sheet).getByText(/Sunday roast/)).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(nav.search).toBe(""))
  })
})
