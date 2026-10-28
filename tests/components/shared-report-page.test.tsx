import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import ShareReportError from "@/app/share/report/[token]/error"
import ShareReportNotFound from "@/app/share/report/[token]/not-found"
import SharedReportPage from "@/app/share/report/[token]/page"
import { SharedClientReportView } from "@/components/share/shared-client-report"
import type { SharedClientReport } from "@/lib/contracts/report-shares"
import {
  GOOGLE_PERFORMANCE_METRICS,
  type GooglePerformanceMetric,
} from "@/lib/domain/google-contract"
import { checkAbuseBudget } from "@/lib/server/abuse-limits"
import { withTenant } from "@/lib/server/db"
import {
  recordReportShareView,
  resolveReportShare,
} from "@/lib/server/report-shares"
import { loadSharedClientReport } from "@/lib/server/shared-report"

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-vercel-forwarded-for": "203.0.113.7" }),
}))
vi.mock("@/lib/server/abuse-limits", () => ({
  checkAbuseBudget: vi.fn(async () => ({
    allowed: true,
    retryAfterSeconds: 0,
  })),
  clientIpFromHeaders: (headers: Headers) =>
    headers.get("x-vercel-forwarded-for"),
}))
vi.mock("@/lib/server/report-shares", () => ({
  resolveReportShare: vi.fn(),
  recordReportShareView: vi.fn(),
}))
vi.mock("@/lib/server/shared-report", () => ({
  loadSharedClientReport: vi.fn(),
}))
vi.mock("@/lib/server/db", () => ({
  withTenant: vi.fn(async (_org: string, fn: (sql: unknown) => unknown) =>
    fn("tenant-sql")
  ),
}))
const afterCallbacks: Array<() => unknown> = []
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => afterCallbacks.push(callback),
}))

const TOKEN = "a".repeat(43)
const SHARE = {
  shareId: "22222222-2222-4222-8222-222222222222",
  organisationId: "00000000-0000-4000-8000-000000000001",
  clientId: "11111111-1111-4111-8111-111111111111",
}

const zeroTotals = Object.fromEntries(
  GOOGLE_PERFORMANCE_METRICS.map((metric) => [metric, 0])
) as Record<GooglePerformanceMetric, number>

const REPORT: SharedClientReport = {
  agencyName: "Harbour Agency",
  clientName: "Old Crown Group",
  venues: ["Old Crown, Sutton", "Old Crown, Cheam"],
  period: {
    id: "28d",
    label: "Last 28 days",
    from: "2026-08-23T12:00:00.000Z",
    to: "2026-09-20T12:00:00.000Z",
    granularity: "day",
  },
  timezone: "Europe/London",
  generatedAt: "2026-09-20T12:00:00.000Z",
  replies: {
    summary: {
      reviewVolume: 12,
      averageRating: 4.4,
      responseRate: 91.7,
      medianFirstResponseSeconds: 5400,
    },
    previous: {
      reviewVolume: 9,
      averageRating: 4.1,
      responseRate: 77.8,
      medianFirstResponseSeconds: 9000,
    },
    series: [
      {
        period: "2026-09-10T00:00:00.000Z",
        reviewCount: 7,
        replies: 6,
        averageRating: 4.5,
      },
      {
        period: "2026-09-11T00:00:00.000Z",
        reviewCount: 5,
        replies: 5,
        averageRating: 4.2,
      },
    ],
    locations: [
      {
        name: "Old Crown, Sutton",
        reviews: 7,
        averageRating: 4.5,
        responseRate: 100,
        medianFirstResponseSeconds: 3600,
        unresolvedComplaints: 0,
      },
      {
        name: "Old Crown, Cheam",
        reviews: 5,
        averageRating: 4.2,
        responseRate: 80,
        medianFirstResponseSeconds: 7200,
        unresolvedComplaints: 1,
      },
    ],
    incomplete: false,
  },
  google: {
    from: "2026-08-24",
    to: "2026-09-20",
    freshThrough: "2026-09-18",
    totals: { ...zeroTotals, CALL_CLICKS: 31, WEBSITE_CLICKS: 58 },
    series: [{ date: "2026-09-10", metrics: { CALL_CLICKS: 31 } }],
  },
}

const call = (
  token: string,
  query: Record<string, string | string[] | undefined> = {}
) =>
  SharedReportPage({
    params: Promise.resolve({ token }),
    searchParams: Promise.resolve(query),
  })

beforeEach(() => {
  vi.clearAllMocks()
  afterCallbacks.length = 0
})

describe("/share/report/[token]", () => {
  it("is a 404 for a token that does not resolve (unknown, expired or revoked alike)", async () => {
    vi.mocked(resolveReportShare).mockResolvedValue(null)
    await expect(call(TOKEN)).rejects.toMatchObject({
      digest: expect.stringMatching(/404/),
    })
    // Nothing is read for a dead link, and nothing is counted.
    expect(withTenant).not.toHaveBeenCalled()
    expect(loadSharedClientReport).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(0)
  })

  it("counts the lookup against the client IP before resolving the token", async () => {
    vi.mocked(resolveReportShare).mockResolvedValue(SHARE)
    vi.mocked(loadSharedClientReport).mockResolvedValue(REPORT)
    await call(TOKEN)
    expect(checkAbuseBudget).toHaveBeenCalledWith("report_share", {
      ip: "203.0.113.7",
    })
  })

  it("is the same 404, resolving nothing, for an address over its limit", async () => {
    vi.mocked(checkAbuseBudget).mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 120,
    })
    vi.mocked(resolveReportShare).mockResolvedValue(SHARE)
    await expect(call(TOKEN)).rejects.toMatchObject({
      digest: expect.stringMatching(/404/),
    })
    expect(resolveReportShare).not.toHaveBeenCalled()
    expect(withTenant).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(0)
  })

  it("is the same 404 when the client has gone since the link was made", async () => {
    vi.mocked(resolveReportShare).mockResolvedValue(SHARE)
    vi.mocked(loadSharedClientReport).mockResolvedValue(null)
    await expect(call(TOKEN)).rejects.toMatchObject({
      digest: expect.stringMatching(/404/),
    })
    expect(afterCallbacks).toHaveLength(0)
  })

  it("reads only the link's own organisation and client, whatever the address says", async () => {
    vi.mocked(resolveReportShare).mockResolvedValue(SHARE)
    vi.mocked(loadSharedClientReport).mockResolvedValue(REPORT)
    await call(TOKEN, {
      period: "18m",
      clientId: "99999999-9999-4999-8999-999999999999",
      organisationId: "99999999-9999-4999-8999-999999999998",
      locationId: "99999999-9999-4999-8999-999999999997",
    })
    expect(resolveReportShare).toHaveBeenCalledWith(TOKEN)
    expect(withTenant).toHaveBeenCalledWith(
      SHARE.organisationId,
      expect.any(Function)
    )
    // The period outside the allowlist reads as the default; nothing else
    // in the query string reaches the loader.
    expect(loadSharedClientReport).toHaveBeenCalledWith(
      "tenant-sql",
      SHARE,
      "28d"
    )
  })

  it("passes an allowlisted period through", async () => {
    vi.mocked(resolveReportShare).mockResolvedValue(SHARE)
    vi.mocked(loadSharedClientReport).mockResolvedValue(REPORT)
    await call(TOKEN, { period: "12m" })
    expect(loadSharedClientReport).toHaveBeenCalledWith(
      "tenant-sql",
      SHARE,
      "12m"
    )
  })

  it("counts the view after the response", async () => {
    vi.mocked(resolveReportShare).mockResolvedValue(SHARE)
    vi.mocked(loadSharedClientReport).mockResolvedValue(REPORT)
    await call(TOKEN)
    expect(recordReportShareView).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(1)
    await afterCallbacks[0]()
    expect(recordReportShareView).toHaveBeenCalledWith(SHARE)
  })
})

describe("the not-found page", () => {
  it("says the link is unavailable, without saying why, and links nowhere", () => {
    render(<ShareReportNotFound />)
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This report link isn’t available",
      })
    ).toBeInTheDocument()
    expect(screen.queryAllByRole("link")).toHaveLength(0)
    expect(screen.queryAllByRole("button")).toHaveLength(0)
  })
})

describe("the error page", () => {
  it("re-fetches the report with Next's retry, not a bare re-render", async () => {
    const retry = vi.fn()
    const unstableRetry = vi.fn()
    const reset = vi.fn()
    render(
      <ShareReportError
        reset={reset}
        retry={retry}
        unstable_retry={unstableRetry}
      />
    )
    expect(
      screen.getByText("This report couldn’t be loaded")
    ).toBeInTheDocument()
    const button = screen.getByRole("button", { name: "Try again" })
    expect(button).not.toBeDisabled()
    expect(button).not.toHaveAttribute("aria-busy")
    await userEvent.click(button)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(unstableRetry).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
    // Nothing to follow into the app.
    expect(screen.queryAllByRole("link")).toHaveLength(0)
  })

  it("falls back to unstable_retry, then to reset", async () => {
    const unstableRetry = vi.fn()
    const reset = vi.fn()
    const { unmount } = render(
      <ShareReportError reset={reset} unstable_retry={unstableRetry} />
    )
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(unstableRetry).toHaveBeenCalledTimes(1)
    expect(reset).not.toHaveBeenCalled()
    unmount()

    render(<ShareReportError reset={reset} />)
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})

describe("SharedClientReportView", () => {
  it("shows the client, venues, period, agency and figures", () => {
    render(<SharedClientReportView report={REPORT} />)
    expect(
      screen.getByRole("heading", { level: 1, name: "Old Crown Group" })
    ).toBeInTheDocument()
    expect(screen.getByText("Harbour Agency")).toBeInTheDocument()
    expect(
      screen.getByText("Old Crown, Sutton, Old Crown, Cheam")
    ).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Google Business Profile" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "By listing" })
    ).toBeInTheDocument()
  })

  it("links only to its own periods, never into the app", () => {
    render(<SharedClientReportView report={REPORT} />)
    const links = screen.getAllByRole("link")
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      // The skip link stays on the page.
      "#main",
      // Each ends #period so switching period lands on the period line,
      // with the period links and the first figures under it.
      "?period=28d#period",
      "?period=90d#period",
      "?period=12m#period",
    ])
    const periodLine = document.getElementById("period")
    expect(periodLine?.tagName).toBe("P")
    expect(periodLine).toHaveTextContent(/^Last 28 days/)
    expect(periodLine).toHaveClass("scroll-mt-4")
    const nav = screen.getByRole("navigation", { name: "Report period" })
    expect(
      within(nav).getByRole("link", { name: "Last 28 days" })
    ).toHaveAttribute("aria-current", "page")
  })

  it("opens on the name and period, with the metadata in the footer", () => {
    render(<SharedClientReportView report={REPORT} />)
    const banner = screen.getByRole("banner")
    expect(
      within(banner).getByRole("heading", { level: 1, name: "Old Crown Group" })
    ).toBeInTheDocument()
    // The period is stated once, beside the name, then the period links.
    expect(
      within(banner).getByText(/Last 28 days/, { selector: "p" })
    ).toBeInTheDocument()
    expect(
      within(banner).getByRole("navigation", { name: "Report period" })
    ).toBeInTheDocument()
    // No metadata table up there any more.
    expect(banner.querySelector("dl")).toBeNull()
    expect(within(banner).queryByText("Prepared by")).not.toBeInTheDocument()
    expect(within(banner).queryByText("Listings")).not.toBeInTheDocument()
    expect(within(banner).queryByText("Generated")).not.toBeInTheDocument()

    const footer = screen.getByRole("contentinfo")
    expect(within(footer).getByText("Listings")).toBeInTheDocument()
    expect(
      within(footer).getByText("Old Crown, Sutton, Old Crown, Cheam")
    ).toBeInTheDocument()
    expect(within(footer).getByText("Prepared by")).toBeInTheDocument()
    expect(within(footer).getByText("Harbour Agency")).toBeInTheDocument()
    expect(within(footer).getByText("Generated")).toBeInTheDocument()
    expect(footer.querySelector("time")).not.toBeNull()
  })

  it("names a single venue in the singular", () => {
    render(
      <SharedClientReportView
        report={{ ...REPORT, venues: ["Old Crown, Sutton"] }}
      />
    )
    const footer = screen.getByRole("contentinfo")
    expect(within(footer).getByText("Listing")).toBeInTheDocument()
    expect(within(footer).queryByText("Listings")).not.toBeInTheDocument()
  })

  it("says so in the footer when there are no venues yet", () => {
    render(<SharedClientReportView report={{ ...REPORT, venues: [] }} />)
    expect(
      within(screen.getByRole("contentinfo")).getByText("None yet")
    ).toBeInTheDocument()
  })

  it("says the report has no listings yet, instead of zero figures", () => {
    render(
      <SharedClientReportView
        report={{
          ...REPORT,
          venues: [],
          google: null,
          replies: {
            ...REPORT.replies,
            summary: {
              reviewVolume: 0,
              averageRating: null,
              responseRate: null,
              medianFirstResponseSeconds: null,
            },
            previous: null,
            series: [],
            locations: [],
          },
        }}
      />
    )
    const main = screen.getByRole("main")
    expect(
      within(main).getByRole("heading", {
        level: 3,
        name: "No listings in this report yet",
      })
    ).toBeInTheDocument()
    expect(main).toHaveTextContent(
      "Harbour Agency hasn’t added any listings for Old Crown Group yet. Figures appear here once they do."
    )
    // Not the reply panel's "for these listings", and no zero tiles.
    expect(
      within(main).queryByText("No reviews in this period")
    ).not.toBeInTheDocument()
    expect(within(main).queryByText("Response rate")).not.toBeInTheDocument()
    // With no listings there is no Google section to explain either.
    expect(
      within(main).queryByRole("heading", { name: "Google Business Profile" })
    ).not.toBeInTheDocument()
  })

  it("keeps the Google section, with one sentence, when the period has no Google figures", () => {
    render(<SharedClientReportView report={{ ...REPORT, google: null }} />)
    const section = screen
      .getByRole("heading", { level: 2, name: "Google Business Profile" })
      .closest("section") as HTMLElement
    expect(
      within(section).getByText("No Google Business Profile figures to show.")
    ).toBeInTheDocument()
    expect(within(section).queryByRole("button")).not.toBeInTheDocument()
    expect(within(section).queryByText("Search views")).not.toBeInTheDocument()
  })

  it("states Google's period and last day in one line, without the fetch history", () => {
    render(<SharedClientReportView report={REPORT} />)
    const section = screen
      .getByRole("heading", { level: 2, name: "Google Business Profile" })
      .closest("section") as HTMLElement
    expect(
      within(section).getByText(
        /^24 Aug( 2026)? – 20 Sept( 2026)? · Figures up to 18 Sept( 2026)?, as reported by Google$/
      )
    ).toBeInTheDocument()
    expect(section).not.toHaveTextContent(/fetch/i)
    expect(section).not.toHaveTextContent(/up to date/)
  })

  it("leaves out the last day when Google has reported none", () => {
    render(
      <SharedClientReportView
        report={{
          ...REPORT,
          google: { ...REPORT.google!, freshThrough: null },
        }}
      />
    )
    const section = screen
      .getByRole("heading", { level: 2, name: "Google Business Profile" })
      .closest("section") as HTMLElement
    expect(
      within(section).getByText(/^24 Aug( 2026)? – 20 Sept( 2026)?$/)
    ).toBeInTheDocument()
    expect(section).not.toHaveTextContent(/Figures up to/)
  })

  it("states the venues it covers and never shows a missing venue as zero", () => {
    const { container } = render(
      <SharedClientReportView
        report={{
          ...REPORT,
          google: {
            ...REPORT.google!,
            totals: {
              ...REPORT.google!.totals,
              BUSINESS_BOOKINGS: null,
            },
            completeness: {
              state: "partial",
              expected: 3,
              covered: 2,
              completeThrough: "2026-09-12",
              missing: [{ name: "Old Crown, Cheam", reason: "unavailable" }],
              refreshFailed: [],
            },
          },
        }}
      />
    )
    const banner = container.querySelector(
      "[data-slot=partial-coverage]"
    ) as HTMLElement
    expect(
      within(banner).getByText("Showing 2 of 3 listings")
    ).toBeInTheDocument()
    expect(
      within(banner).getByText(/Could not be refreshed: Old Crown, Cheam/)
    ).toBeInTheDocument()
    expect(
      within(banner).getByText(
        /Complete for every listing shown through 12 Sept/
      )
    ).toBeInTheDocument()
    // Said once, in the alert: the provenance line is gone from this page.
    expect(
      screen.queryByText(/All reporting listings complete through/)
    ).not.toBeInTheDocument()
  })

  it("shows no coverage banner for a complete report", () => {
    const { container } = render(
      <SharedClientReportView
        report={{
          ...REPORT,
          google: {
            ...REPORT.google!,
            completeness: {
              state: "complete",
              expected: 2,
              covered: 2,
              completeThrough: "2026-09-18",
              missing: [],
              refreshFailed: [],
            },
          },
        }}
      />
    )
    expect(container.querySelector("[data-slot=partial-coverage]")).toBeNull()
  })

  it("says so when there were no reviews in either window", () => {
    render(
      <SharedClientReportView
        report={{
          ...REPORT,
          replies: {
            ...REPORT.replies,
            summary: {
              reviewVolume: 0,
              averageRating: null,
              responseRate: null,
              medianFirstResponseSeconds: null,
            },
            previous: { ...REPORT.replies.previous!, reviewVolume: 0 },
            series: [],
            locations: [],
          },
        }}
      />
    )
    expect(screen.getByText("No reviews in this period")).toBeInTheDocument()
  })

  it("has landmarks, a skip link and the figures' main region", () => {
    render(<SharedClientReportView report={REPORT} />)
    expect(screen.getByRole("banner")).toBeInTheDocument()
    expect(screen.getByRole("main")).toHaveAttribute("id", "main")
    expect(screen.getByRole("contentinfo")).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Skip to the figures" })
    ).toHaveAttribute("href", "#main")
  })

  it("writes the generated time in the organisation's zone, named", () => {
    const { container } = render(
      <SharedClientReportView
        report={{ ...REPORT, timezone: "Pacific/Auckland" }}
      />
    )
    const time = container.querySelector(
      'time[datetime="2026-09-20T12:00:00.000Z"]'
    )
    // Noon UTC on 20 Sep is midnight on the 21st in Auckland (NZST).
    expect(time?.textContent).toMatch(/21 Sept( 2026)?, 00:00 GMT\+12/)
  })

  it("warns in the client's words when the figures may be incomplete", () => {
    render(
      <SharedClientReportView
        report={{ ...REPORT, replies: { ...REPORT.replies, incomplete: true } }}
      />
    )
    // A static warning on the shared page: read in place, not an alert.
    expect(
      screen
        .getByText("These figures may be incomplete")
        .closest('[data-slot="alert"]')
    ).toHaveTextContent(/may not be counted yet/)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getAllByText("These figures may be incomplete")).toHaveLength(
      1
    )
  })

  it("never says no reviews beside tiles that count some", () => {
    render(
      <SharedClientReportView
        report={{
          ...REPORT,
          replies: {
            ...REPORT.replies,
            series: REPORT.replies.series.map((point) => ({
              ...point,
              reviewCount: 0,
              replies: 0,
              averageRating: null,
            })),
          },
        }}
      />
    )
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(
      screen.queryByText("No reviews in this period")
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByText("Chart unavailable for this period")
    ).toHaveLength(2)
  })
})
