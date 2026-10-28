import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { ClientScopeRoot } from "@/components/app-shell/client-context"
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

// The viewer's zone is the browser's; pin it so the test names zones the same
// wherever it runs. `null` is the server render and hydration.
const viewer = vi.hoisted(() => ({ zone: "Europe/London" as string | null }))
vi.mock("@/lib/hooks/use-viewer-time-zone", () => ({
  useViewerTimeZone: () => viewer.zone,
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
  viewer.zone = "Europe/London"
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

describe("PublicationCalendar time zone names", () => {
  async function openAgenda() {
    renderWithProviders(<PublicationCalendar timeZone="Pacific/Auckland" />)
    await screen.findByRole("region", { name: "Calendar grid" })
    await userEvent.click(screen.getByRole("tab", { name: "Agenda" }))
    return screen.findByRole("list", { name: "Scheduled publications" })
  }

  it("names the listing's zone for a viewer elsewhere, never the IANA id", async () => {
    viewer.zone = "America/New_York"
    const agenda = await openAgenda()
    expect(within(agenda).getAllByText(/^UK time/).length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toContain("Europe/London")
    expect(document.body.textContent).not.toContain("Pacific/Auckland")
    expect(
      screen.getByText(/Today follows the workspace’s New Zealand time\./)
    ).toBeInTheDocument()
  })

  it("leaves the workspace's zone unsaid for a viewer on the same clock", async () => {
    renderWithProviders(<PublicationCalendar timeZone="Europe/London" />)
    await screen.findByRole("region", { name: "Calendar grid" })
    expect(
      screen.getByText(
        "Every scheduled post across the listings you can see, at each listing’s local time. Open one to manage its schedule on that listing’s Posts tab."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/Today follows/)).not.toBeInTheDocument()
  })

  it("says nothing extra for someone on the listing's own clock", async () => {
    const agenda = await openAgenda()
    expect(within(agenda).queryByText(/^UK time/)).not.toBeInTheDocument()
    // The clock-change note still shows, without a stray separator.
    expect(within(agenda).getByText(/^Clocks go back/)).toBeInTheDocument()
  })

  it("says nothing until the viewer's zone is known", async () => {
    viewer.zone = null
    const agenda = await openAgenda()
    expect(within(agenda).queryByText(/UK time/)).not.toBeInTheDocument()
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
      await screen.findByText(/Posts cannot be scheduled in this workspace/)
    ).toBeInTheDocument()
    // It replaced a calendar that was drawing, so it is announced.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Scheduled publishing is off"
    )
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
      screen.queryByText(/Every scheduled post across the listings/)
    ).not.toBeInTheDocument()
    // The page already knew: a quiet page, not an announcement.
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
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

// A session the schema accepts, so the role and the workspace mode resolve.
const session = (
  role: "owner" | "admin" | "member" | "viewer",
  workspaceMode: "agency" | "business" = "agency"
) => ({
  session: {
    userId: "u1",
    organisationId: "o1",
    organisationName: "Fixture Agency",
    displayName: "Pat",
    email: "pat@example.test",
    role,
    canPublish: role !== "viewer",
    workspaceMode,
  },
})

const OLD_CROWN = "00000000-0000-4000-8000-000000000002"
const RED_LION = "00000000-0000-4000-8000-000000000003"

/**
 * The fetch stub with the parts a case varies: the occurrences answer, the
 * session and the listing directory a member sees. Records every
 * occurrences request.
 */
function stubFetch({
  occurrences = () => jsonResponse({ occurrences: OCCURRENCES }),
  sessionBody = session("member"),
  locations = [] as { id: string; name: string }[],
}: {
  occurrences?: () => Response | Promise<Response>
  sessionBody?: unknown
  locations?: { id: string; name: string }[]
} = {}) {
  const calls: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.includes("/api/post-schedules/occurrences")) {
        calls.push(url)
        return occurrences()
      }
      if (url.includes("/api/clients"))
        return jsonResponse({ items: [], unassignedLocationCount: 0 })
      if (url.includes("/api/session")) return jsonResponse(sessionBody)
      return jsonResponse({
        locations: locations.map((location) => ({
          ...location,
          linked: true,
          clientId: null,
          clientName: null,
        })),
      })
    })
  )
  return calls
}

function errorResponse(status: number, error: string) {
  return new Response(JSON.stringify({ error, message: "Server said no." }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("PublicationCalendar period summary", () => {
  it("counts the month's publications in one line", async () => {
    renderWithProviders(<PublicationCalendar />)
    await screen.findByRole("region", { name: "Calendar grid" })
    expect(
      screen.getByText("2 publications in October 2026.")
    ).toBeInTheDocument()
  })

  it("says an empty month is empty and offers Listings", async () => {
    stubFetch({ occurrences: () => jsonResponse({ occurrences: [] }) })
    renderWithProviders(<PublicationCalendar />)
    expect(
      await screen.findByText(
        "Nothing scheduled in October 2026. Use the arrows to look at another month. Posts are scheduled from each listing’s Posts tab."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Go to Listings" })
    ).toHaveAttribute("href", "/listings")
  })

  it("names the filter on an empty period, and clears it", async () => {
    stubFetch({
      occurrences: () => jsonResponse({ occurrences: [] }),
      locations: [
        { id: OLD_CROWN, name: "Old Crown" },
        { id: RED_LION, name: "Red Lion" },
      ],
    })
    nav.set(
      `locationId=${OLD_CROWN}&clientId=00000000-0000-4000-8000-0000000000c1`
    )
    renderWithProviders(<PublicationCalendar />)
    expect(
      await screen.findByText(
        "Nothing scheduled in October 2026 for Old Crown."
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Go to Listings" })
    ).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: "Show every listing" })
    )
    expect(nav.search).toBe("")
  })

  it("uses the same words for an empty agenda", async () => {
    stubFetch({ occurrences: () => jsonResponse({ occurrences: [] }) })
    nav.set("view=agenda")
    renderWithProviders(<PublicationCalendar />)
    expect(
      await screen.findByText(/^Nothing scheduled in 15 Oct\s?–\s?14 Nov 2026$/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Go to Listings" })
    ).toBeInTheDocument()
  })
})

describe("PublicationCalendar busy and problem days", () => {
  it("opens every publication of a busy day from its +N more", async () => {
    const busy = Array.from({ length: 5 }, (_, index) => ({
      ...occurrence(
        `00000000-0000-4000-8000-0000000000b${index}`,
        "2026-10-25",
        `1${index}:00`,
        "none",
        `Special ${index + 1}`
      ),
    }))
    stubFetch({ occurrences: () => jsonResponse({ occurrences: busy }) })
    renderWithProviders(<PublicationCalendar />)
    // The wide cell is the container-query form, which jsdom's stylesheet
    // leaves hidden (so no accessible name): find it by its words.
    const more = await screen.findByText(/^\+2 more/, { selector: "button" })
    expect(more).toHaveTextContent(
      "+2 more on Sunday 25 October, in the agenda"
    )
    more.focus()
    await userEvent.keyboard("{Enter}")
    expect(nav.search).toBe("view=agenda&date=2026-10-25")
    const agenda = await screen.findByRole("list", {
      name: "Scheduled publications",
    })
    expect(within(agenda).getAllByRole("link")).toHaveLength(5)
  })

  it("names a run that needs attention in the grid, not by colour alone", async () => {
    stubFetch({
      occurrences: () =>
        jsonResponse({
          occurrences: [
            {
              ...OCCURRENCES[1],
              status: "missed",
              statusReason: "paused_when_due",
            },
          ],
        }),
    })
    renderWithProviders(<PublicationCalendar />)
    const grid = await screen.findByRole("region", { name: "Calendar grid" })
    expect(
      within(grid).getByRole("button", {
        name: "Sunday 25 October, 1 publication, 1 needs attention",
      })
    ).toBeInTheDocument()
    expect(within(grid).getByText("Missed")).toBeInTheDocument()
  })

  it("keeps a scheduled run to one line in the grid", async () => {
    renderWithProviders(<PublicationCalendar />)
    const grid = await screen.findByRole("region", { name: "Calendar grid" })
    expect(within(grid).queryByText("Scheduled")).not.toBeInTheDocument()
  })
})

describe("PublicationCalendar loading a new period", () => {
  it("keeps the grid in place, hidden from assistive tech, behind a loading line", async () => {
    // The first period is answered at once; the next one is held.
    let release: (response: Response) => void = () => {}
    const calls = stubFetch({
      occurrences: () =>
        calls.length === 1
          ? jsonResponse({ occurrences: OCCURRENCES })
          : new Promise<Response>((resolve) => (release = resolve)),
    })
    renderWithProviders(<PublicationCalendar />)
    await screen.findByRole("region", { name: "Calendar grid" })
    await userEvent.click(screen.getByRole("button", { name: "Next month" }))
    const loading = await screen.findByText("Loading scheduled publications")
    expect(loading.closest('[role="status"]')).not.toBeNull()
    // The grid is drawn, but only the line above is announced or reachable.
    expect(
      screen.queryByRole("region", { name: "Calendar grid" })
    ).not.toBeInTheDocument()
    const placeholder = document.querySelector('[data-slot="calendar-grid"]')
    expect(placeholder?.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(placeholder?.closest("[inert]")).not.toBeNull()
    // Never the last period's publications.
    expect(placeholder?.querySelector("a, button")).toBeNull()
    release(jsonResponse({ occurrences: [] }))
    expect(
      await screen.findByText(/^Nothing scheduled in November 2026\./)
    ).toBeInTheDocument()
  })

  it("draws list placeholders, not a grid, on the first load", () => {
    stubFetch({ occurrences: () => new Promise<Response>(() => {}) })
    renderWithProviders(<PublicationCalendar />)
    expect(screen.getByText("Loading scheduled publications")).toBeVisible()
    expect(
      document.querySelector('[data-slot="calendar-grid"]')
    ).not.toBeInTheDocument()
  })
})

describe("PublicationCalendar filters from the address", () => {
  it("ignores a listing id that is not an id", async () => {
    const calls = stubFetch()
    nav.set("locationId=not-a-uuid")
    renderWithProviders(<PublicationCalendar />)
    await screen.findByRole("region", { name: "Calendar grid" })
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((url) => !url.includes("locationId"))).toBe(true)
    expect(
      screen.queryByText("Scheduled publications could not be loaded")
    ).not.toBeInTheDocument()
  })

  it("ignores a listing the viewer cannot pick once the directory is known", async () => {
    const calls = stubFetch({
      locations: [
        { id: OLD_CROWN, name: "Old Crown" },
        { id: RED_LION, name: "Red Lion" },
      ],
    })
    nav.set("locationId=00000000-0000-4000-8000-000000000999")
    renderWithProviders(<PublicationCalendar />)
    await waitFor(() => expect(calls.at(-1)).not.toMatch(/locationId=/))
    expect(
      await screen.findByText("2 publications in October 2026.")
    ).toBeInTheDocument()
  })
})

describe("PublicationCalendar off-state copy", () => {
  it("tells an admin only support can switch it on, and it is not a setting", async () => {
    stubFetch({ sessionBody: session("admin") })
    renderWithProviders(<PublicationCalendar scheduling={false} />)
    expect(
      await screen.findByText(
        /Only NabaPresence support can switch scheduled publishing on; it is not a workspace setting\./
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/each listing’s Posts tab\./)).toBeInTheDocument()
    expect(screen.queryByText(/ask an owner or admin/)).not.toBeInTheDocument()
  })

  it.each(["viewer", "member"] as const)(
    "tells a %s to ask an owner or admin to request it",
    async (role) => {
      stubFetch({ sessionBody: session(role) })
      renderWithProviders(<PublicationCalendar scheduling={false} />)
      expect(
        await screen.findByText(
          /If you need it, ask an owner or admin to request it from NabaPresence support\./
        )
      ).toBeInTheDocument()
      expect(
        screen.queryByText(/Only NabaPresence support/)
      ).not.toBeInTheDocument()
      expect(screen.queryByText(/straight away/)).not.toBeInTheDocument()
    }
  )

  it("opens Listings on the remembered client in an agency", async () => {
    stubFetch({ sessionBody: session("owner") })
    const client = "00000000-0000-4000-8000-0000000000c1"
    renderWithProviders(
      <ClientScopeRoot rememberedClientId={client}>
        <PublicationCalendar scheduling={false} />
      </ClientScopeRoot>
    )
    expect(
      screen.getByRole("link", { name: "Go to Listings" })
    ).toHaveAttribute("href", `/listings?clientId=${client}`)
  })

  it("opens plain Listings in a business, whatever was remembered", async () => {
    stubFetch({ sessionBody: session("owner", "business") })
    renderWithProviders(
      <ClientScopeRoot rememberedClientId="00000000-0000-4000-8000-0000000000c1">
        <PublicationCalendar scheduling={false} />
      </ClientScopeRoot>
    )
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Go to Listings" })
      ).toHaveAttribute("href", "/listings")
    )
  })
})

describe("PublicationCalendar load errors", () => {
  it("does not blame Google for a server failure, and retries it once", async () => {
    const calls = stubFetch({
      occurrences: () => errorResponse(500, "internal_error"),
    })
    renderWithProviders(<PublicationCalendar />)
    const alert = await screen.findByRole("alert", {}, { timeout: 4000 })
    expect(alert).toHaveTextContent(
      "Scheduled publications could not be loaded"
    )
    expect(alert).toHaveTextContent(
      "NabaPresence could not read the schedule just now. Nothing has changed. Try again in a moment."
    )
    expect(alert).not.toHaveTextContent(/Google/)
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
    expect(calls).toHaveLength(2)
  })

  it("does not repeat a request the server refused", async () => {
    const calls = stubFetch({
      occurrences: () => errorResponse(403, "forbidden"),
    })
    renderWithProviders(<PublicationCalendar />)
    await screen.findByRole("alert")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls).toHaveLength(1)
  })
})
