import { act } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  PresenceCaption,
  PresenceProvenance,
} from "@/components/reporting/presence-provenance"
import {
  presenceResponseSchema,
  type PresenceResponse,
} from "@/lib/contracts/analytics"
import { GOOGLE_PERFORMANCE_METRICS } from "@/lib/domain/google-contract"
import {
  classifyLocationCoverage,
  countLocationCoverage,
} from "@/lib/domain/report-coverage"

const DATA = {
  freshThrough: "2026-10-11",
  fetchedAt: {
    oldest: "2026-10-12T20:12:00.000Z",
    newest: "2026-10-12T20:12:00.000Z",
  },
  coverage: null,
  completeness: null,
} as unknown as PresenceResponse

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ""
})

describe("PresenceProvenance", () => {
  it("writes the fetch time in a given zone, named, inside <time>", () => {
    const html = renderToString(
      <PresenceProvenance data={DATA} timeZone="Pacific/Auckland" />
    )
    expect(html).toContain('<time dateTime="2026-10-12T20:12:00.000Z">')
    // The year shows only outside the current one.
    expect(html).toMatch(/13 Oct( 2026)?, 09:12 GMT\+13/)
  })

  it("renders UTC on the server when no zone is given, so hydration agrees", async () => {
    const html = renderToString(<PresenceProvenance data={DATA} />)
    expect(html).toMatch(/12 Oct( 2026)?, 20:12 UTC/)

    const container = document.createElement("div")
    container.innerHTML = html
    document.body.appendChild(container)
    const recoverable = vi.fn()
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    await act(async () => {
      hydrateRoot(container, <PresenceProvenance data={DATA} />, {
        onRecoverableError: recoverable,
      })
    })
    expect(recoverable).not.toHaveBeenCalled()
    expect(
      errors.mock.calls.some((call) => /hydrat/i.test(String(call[0])))
    ).toBe(false)
    // After mount it is the viewer's own zone (the test runner's).
    expect(container.querySelector("time")?.textContent).toMatch(/1[23] Oct/)
  })
})

describe("PresenceProvenance coverage", () => {
  it("says each location's one state in plain words, adding up to the locations in scope", () => {
    const html = renderToString(
      <PresenceProvenance
        data={
          {
            ...DATA,
            coverage: {
              eligible: 6,
              reporting: 1,
              unconfirmed: 1,
              unavailable: 1,
              stale: 1,
              pending: 1,
              noData: 1,
            },
          } as unknown as PresenceResponse
        }
        timeZone="Europe/London"
      />
    )
    expect(html).toContain(
      "1 of 6 locations up to date · 1 with figures but no recorded fetch · 1 waiting for a first fetch · refresh failed for 1 · 1 out of date · 1 sent no figures"
    )
    expect(html).toContain("Figures up to 11 Oct")
  })

  it("renders no up-to-date claim and no contradiction for an unconfirmed location (classifier to provenance)", () => {
    const counts = countLocationCoverage(
      classifyLocationCoverage(
        [{ id: "a", name: "Alpha" }],
        [
          {
            locationId: "a",
            status: "pending",
            watermark: null,
            lastSucceededAt: null,
          },
        ],
        {
          windowStart: "2026-09-01",
          staleBefore: new Date("2026-10-01T00:00:00Z"),
          latestStored: new Map([["a", "2026-10-08"]]),
        }
      )
    )
    const data = presenceResponseSchema.parse({
      range: "28d",
      from: "2026-09-01",
      to: "2026-09-28",
      state: "ready",
      freshThrough: "2026-10-08",
      locations: [],
      totals: Object.fromEntries(
        GOOGLE_PERFORMANCE_METRICS.map((metric) => [metric, 5])
      ),
      series: [],
      unavailableReasons: [],
      keywordsEnabled: false,
      ingestionEnabled: true,
      coverage: counts,
      fetchedAt: { oldest: null, newest: null },
    })
    // The stored figures are still in the totals.
    expect(data.totals.WEBSITE_CLICKS).toBe(5)
    const sheet = renderToString(<PresenceProvenance data={data} />)
    expect(sheet).toContain("Nothing fetched from Google yet")
    expect(sheet).toContain(
      "0 of 1 location up to date · 1 with figures but no recorded fetch"
    )
    expect(sheet).not.toContain("1 of 1 location up to date")
    const caption = renderToString(<PresenceCaption data={data} />)
    expect(caption).toContain("0 of 1 location up to date")
    expect(caption).not.toContain("1 of 1 location up to date")
  })
})
