import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import ShareReportNotFound from "@/app/share/report/[token]/not-found"
import SharedReportPage from "@/app/share/report/[token]/page"
import { SharedClientReportView } from "@/components/share/shared-client-report"
import type { SharedClientReport } from "@/lib/contracts/report-shares"
import {
  GOOGLE_PERFORMANCE_METRICS,
  type GooglePerformanceMetric,
} from "@/lib/domain/google-contract"
import { withTenant } from "@/lib/server/db"
import {
  recordReportShareView,
  resolveReportShare,
} from "@/lib/server/report-shares"
import { loadSharedClientReport } from "@/lib/server/shared-report"

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
      screen.getByRole("heading", { name: "By venue" })
    ).toBeInTheDocument()
  })

  it("links only to its own periods, never into the app", () => {
    render(<SharedClientReportView report={REPORT} />)
    const links = screen.getAllByRole("link")
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "?period=28d",
      "?period=90d",
      "?period=12m",
    ])
    const nav = screen.getByRole("navigation", { name: "Report period" })
    expect(
      within(nav).getByRole("link", { name: "Last 28 days" })
    ).toHaveAttribute("aria-current", "page")
  })

  it("leaves out the Google section when there are no Google figures", () => {
    render(<SharedClientReportView report={{ ...REPORT, google: null }} />)
    expect(
      screen.queryByRole("heading", { name: "Google Business Profile" })
    ).not.toBeInTheDocument()
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
})
