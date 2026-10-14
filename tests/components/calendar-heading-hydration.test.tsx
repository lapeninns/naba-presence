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

function agendaHeading() {
  const anchor = utcDay("2026-10-14")
  return periodHeading("agenda", anchor, windowFor("agenda", anchor))
}

/** Server-render `render`, then hydrate it where `formatRange` spaces like Chromium. */
async function hydrateInBrowserIcu(render: () => string) {
  const formatRange = vi
    .spyOn(Intl.DateTimeFormat.prototype, "formatRange")
    .mockReturnValue(SERVER_RANGE)
  const Heading = () => <h2>{render()}</h2>
  const html = renderToString(<Heading />)
  const container = document.createElement("div")
  container.innerHTML = html
  document.body.appendChild(container)

  formatRange.mockReturnValue(BROWSER_RANGE)
  const errors: unknown[] = []
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  let root: ReturnType<typeof hydrateRoot> | undefined
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
  consoleError.mockRestore()
  const text = container.textContent
  act(() => root!.unmount())
  container.remove()
  return { hydrationErrors, text }
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
    const { hydrationErrors, text } = await hydrateInBrowserIcu(agendaHeading)
    expect(hydrationErrors).toEqual([])
    expect(text).toBe(BROWSER_RANGE)
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
