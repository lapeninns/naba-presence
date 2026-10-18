import { act } from "@testing-library/react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  periodHeading,
  utcDay,
  windowFor,
} from "@/components/calendar/calendar-dates"

// RC3 #5: /calendar?view=agenda hydrated with React #418 (text). The
// period heading is an Intl range, and Node's ICU spaces it with thin
// spaces ("14 Oct – 13 Nov 2026") where Chromium's uses plain
// ones ("14 Oct – 13 Nov 2026"), so the server's text never matched the
// browser's.

const BROWSER_RANGE = "14 Oct – 13 Nov 2026"
const SERVER_RANGE = "14 Oct – 13 Nov 2026"

function rangeParts(
  startDay: string,
  startMonth: string,
  endDay: string,
  endMonth: string,
  space: string
): Intl.DateTimeRangeFormatPart[] {
  return [
    { type: "day", value: startDay, source: "startRange" },
    { type: "literal", value: " ", source: "startRange" },
    { type: "month", value: startMonth, source: "startRange" },
    { type: "literal", value: `${space}–${space}`, source: "shared" },
    { type: "day", value: endDay, source: "endRange" },
    { type: "literal", value: " ", source: "endRange" },
    { type: "month", value: endMonth, source: "endRange" },
    { type: "literal", value: " ", source: "shared" },
    { type: "year", value: "2026", source: "shared" },
  ]
}

function agendaHeading() {
  const anchor = utcDay("2026-10-14")
  return periodHeading("agenda", anchor, windowFor("agenda", anchor))
}

/** Simulate both native range APIs, so changing which one a helper uses cannot bypass the test. */
async function hydrateInBrowserIcu(
  render: () => string,
  serverRange = SERVER_RANGE,
  browserRange = BROWSER_RANGE,
  serverParts = rangeParts("14", "Oct", "13", "Nov", "\u2009"),
  browserParts = rangeParts("14", "Oct", "13", "Nov", " ")
) {
  const formatRange = vi
    .spyOn(Intl.DateTimeFormat.prototype, "formatRange")
    .mockReturnValue(serverRange)
  const formatRangeToParts = vi
    .spyOn(Intl.DateTimeFormat.prototype, "formatRangeToParts")
    .mockReturnValue(serverParts)
  const Heading = () => <h2>{render()}</h2>
  const html = renderToString(<Heading />)
  const container = document.createElement("div")
  container.innerHTML = html
  document.body.appendChild(container)

  formatRange.mockReturnValue(browserRange)
  formatRangeToParts.mockReturnValue(browserParts)
  const errors: unknown[] = []
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  let root: ReturnType<typeof hydrateRoot> | undefined
  try {
    await act(async () => {
      root = hydrateRoot(container, <Heading />, {
        onRecoverableError: (error) => errors.push(error),
      })
    })
    const hydrationErrors = [
      ...errors.map(String),
      ...consoleError.mock.calls
        .map((call) => call.map(String).join(" "))
        .filter((line) => /hydrat|didn't match/i.test(line)),
    ]
    return {
      hydrationErrors,
      text: container.textContent,
      partsCalls: formatRangeToParts.mock.calls.length,
    }
  } finally {
    const mountedRoot = root
    if (mountedRoot) act(() => mountedRoot.unmount())
    consoleError.mockRestore()
    container.remove()
  }
}

describe("calendar period heading hydration (RC3 #5)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("spaces the range with plain spaces whatever this ICU does", () => {
    expect(agendaHeading()).toBe(BROWSER_RANGE)
    const week = utcDay("2026-10-12")
    expect(periodHeading("week", week, windowFor("week", week))).toBe(
      "12 – 18 Oct 2026"
    )
  })

  it("hydrates the agenda heading without a text mismatch", async () => {
    const { hydrationErrors, text, partsCalls } =
      await hydrateInBrowserIcu(agendaHeading)
    expect(hydrationErrors).toEqual([])
    expect(text).toBe(BROWSER_RANGE)
    expect(partsCalls).toBeGreaterThan(0)
  })

  it("hydrates a September-to-October week when WebKit's month and ICU spacing differ", async () => {
    const week = utcDay("2026-09-28")
    const { hydrationErrors, text, partsCalls } = await hydrateInBrowserIcu(
      () => periodHeading("week", week, windowFor("week", week)),
      "28 Sept\u2009–\u20094 Oct 2026",
      "28 Sep – 4 Oct 2026",
      rangeParts("28", "Sept", "4", "Oct", "\u2009"),
      rangeParts("28", "Sep", "4", "Oct", " ")
    )
    expect(hydrationErrors).toEqual([])
    expect(text).toBe("28 Sept – 4 Oct 2026")
    expect(partsCalls).toBeGreaterThan(0)
  })

  it.each([
    ["2026-08-31", "31 Aug – 6 Sept 2026"],
    ["2026-09-07", "7 – 13 Sept 2026"],
    ["2026-09-28", "28 Sept – 4 Oct 2026"],
    ["2026-12-28", "28 Dec 2026 – 3 Jan 2027"],
  ])(
    "keeps the native range collapse and endpoint years for week %s",
    (day, expected) => {
      const week = utcDay(day)
      expect(periodHeading("week", week, windowFor("week", week))).toBe(
        expected
      )
    }
  )

  it("keeps the month view's long month and year", () => {
    const month = utcDay("2026-09-01")
    expect(periodHeading("month", month, windowFor("month", month))).toBe(
      "September 2026"
    )
  })

  // The negative control: the raw Intl range is the defect, so the test
  // above can fail.
  it("is a real mismatch when the raw Intl range is rendered (control)", async () => {
    const { hydrationErrors } = await hydrateInBrowserIcu(() =>
      new Intl.DateTimeFormat("en-GB", { timeZone: "UTC" }).formatRange(
        new Date(0),
        new Date(0)
      )
    )
    expect(hydrationErrors.length).toBeGreaterThan(0)
  })
})
