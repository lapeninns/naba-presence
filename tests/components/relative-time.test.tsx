import { act, render, screen } from "@testing-library/react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { RelativeTime } from "@/components/ui/relative-time"
import { formatRelativeTime } from "@/lib/format"

const AT = "2026-10-13T12:00:00.000Z"

describe("RelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("is a <time> with the instant and the absolute time a hover away", () => {
    vi.setSystemTime(new Date("2026-10-13T12:04:10.000Z"))
    render(<RelativeTime iso={AT} />)
    const time = screen.getByText("4 minutes ago")
    expect(time.tagName).toBe("TIME")
    expect(time).toHaveAttribute("datetime", AT)
    // 12:00 UTC is 13:00 in London in October.
    expect(time).toHaveAttribute("title", "13 Oct, 13:00")
  })

  it("joins a prefix and suffix into one text node, cased for its place", () => {
    vi.setSystemTime(new Date("2026-10-13T12:00:20.000Z"))
    const { rerender } = render(
      <RelativeTime iso={AT} prefix="Last run " suffix="." />
    )
    expect(screen.getByText("Last run Just now.")).toBeInTheDocument()
    rerender(<RelativeTime iso={AT} prefix="Checked " casing="mid-sentence" />)
    expect(screen.getByText("Checked just now")).toBeInTheDocument()
    vi.setSystemTime(new Date("2026-10-14T13:00:00.000Z"))
    rerender(<RelativeTime iso={AT} casing="sentence" />)
    expect(screen.getByText("Yesterday")).toBeInTheDocument()
  })

  it("says the date instead outside its age window", () => {
    vi.setSystemTime(new Date("2026-10-14T12:00:01.000Z"))
    render(
      <RelativeTime
        iso={AT}
        within={{ ms: 86_400_000, otherwise: "13 Oct" }}
        as="span"
      />
    )
    const span = screen.getByText("13 Oct")
    expect(span.tagName).toBe("SPAN")
    expect(span).not.toHaveAttribute("datetime")
  })

  it("keeps ageing across a minute boundary on the shared clock", () => {
    vi.setSystemTime(new Date("2026-10-13T12:00:50.000Z"))
    render(<RelativeTime iso={AT} prefix="Checked " />)
    expect(screen.getByText("Checked Just now")).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(screen.getByText("Checked 1 minute ago")).toBeInTheDocument()
  })

  // operations-view's "Last run 16 minutes ago" read "15" under load: the
  // clock was held for a second, so a reading taken by an earlier render
  // (another test, a row before) could predate the fixture's own
  // Date.now() and make an exact 16-minute age 15:59.3. An age is never
  // younger than the moment it is shown.
  it("never reuses a clock read from before the time it is rendered", () => {
    const t0 = new Date("2026-10-13T12:16:00.000Z").getTime()
    vi.setSystemTime(t0)
    render(<RelativeTime iso={AT} />).unmount()
    vi.setSystemTime(t0 + 700)
    const sixteenMinutesAgo = new Date(t0 + 700 - 16 * 60_000).toISOString()
    render(<RelativeTime iso={sixteenMinutesAgo} prefix="Last run " />)
    expect(screen.getByText("Last run 16 minutes ago")).toBeInTheDocument()
  })

  it("stops the shared clock once nothing shows a relative time", () => {
    vi.setSystemTime(new Date("2026-10-13T12:00:50.000Z"))
    const { unmount } = render(<RelativeTime iso={AT} />)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  describe("hydration across a minute boundary", () => {
    let container: HTMLDivElement
    beforeEach(() => {
      container = document.createElement("div")
      document.body.appendChild(container)
    })
    afterEach(() => {
      container.remove()
    })

    /**
     * Server HTML rendered at 12:00:59 ("Just now"), hydrated at 12:01:01
     * ("1 minute ago"): the race the listing page hit in production.
     */
    async function hydrateAcrossMinute(element: React.ReactElement) {
      vi.setSystemTime(new Date("2026-10-13T12:00:59.000Z"))
      container.innerHTML = renderToString(element)
      const serverText = container.textContent
      vi.setSystemTime(new Date("2026-10-13T12:01:01.000Z"))
      const recoverable = vi.fn()
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {})
      let root: ReturnType<typeof hydrateRoot> | undefined
      await act(async () => {
        root = hydrateRoot(container, element, {
          onRecoverableError: recoverable,
        })
      })
      const errors = [...recoverable.mock.calls, ...consoleError.mock.calls]
      consoleError.mockRestore()
      const text = container.textContent
      act(() => root!.unmount())
      return { serverText, text, errors }
    }

    it("hydrates without a mismatch and then shows the browser's time", async () => {
      const { serverText, text, errors } = await hydrateAcrossMinute(
        <p>
          <RelativeTime iso={AT} prefix="Checked " />
        </p>
      )
      expect(serverText).toBe("Checked Just now")
      expect(errors).toEqual([])
      expect(text).toBe("Checked 1 minute ago")
    })

    it("also when the age window flips between server and browser", async () => {
      const element = (
        <p>
          <RelativeTime
            iso="2026-10-12T12:01:00.000Z"
            within={{ ms: 86_400_000, otherwise: "12 Oct" }}
          />
        </p>
      )
      const { serverText, text, errors } = await hydrateAcrossMinute(element)
      expect(serverText).toBe("23 hours ago")
      expect(errors).toEqual([])
      expect(text).toBe("12 Oct")
    })

    // The control: the same race with the time read inline during render is
    // the defect this primitive exists for, so the test above can fail.
    it("is a real race for a relative time read inline during render", async () => {
      function Inline() {
        return <p>Checked {formatRelativeTime(AT)}</p>
      }
      const { errors } = await hydrateAcrossMinute(<Inline />)
      expect(errors.length).toBeGreaterThan(0)
    })
  })
})
