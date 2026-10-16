import { act } from "@testing-library/react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"

import { formatDay } from "@/lib/settings/roles"
import { HYDRATION_DAY_ZONE, useFormatDay } from "@/lib/settings/use-format-day"

// P20 server-renders Team and Reply policy. A date near midnight is a
// different day on a UTC server and in a browser elsewhere, and React
// rejects the page when the server's text and the hydrating browser's
// differ. useFormatDay writes both renders in one pinned zone, then the
// viewer's own.

const NEAR_MIDNIGHT = "2026-09-12T23:30:00.000Z"
const ORIGINAL_TZ = process.env.TZ

function DayProbe({ iso }: { iso: string }) {
  const formatDay = useFormatDay()
  return <p>{formatDay(iso)}</p>
}

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ
})

describe("formatDay", () => {
  it("writes the day in the zone it is given", () => {
    expect(formatDay(NEAR_MIDNIGHT, "UTC")).toBe("12 Sept 2026")
    expect(formatDay(NEAR_MIDNIGHT, "Europe/London")).toBe("13 Sept 2026")
  })
})

describe("useFormatDay", () => {
  it("hydrates a UTC server's HTML in another zone, then shows the viewer's day", async () => {
    process.env.TZ = "UTC"
    const html = renderToString(<DayProbe iso={NEAR_MIDNIGHT} />)
    expect(html).toContain(formatDay(NEAR_MIDNIGHT, HYDRATION_DAY_ZONE))

    process.env.TZ = "America/Los_Angeles"
    const errors: unknown[] = []
    const container = document.createElement("div")
    container.innerHTML = html
    await act(async () => {
      hydrateRoot(container, <DayProbe iso={NEAR_MIDNIGHT} />, {
        onRecoverableError: (error) => errors.push(error),
      })
    })
    expect(errors).toEqual([])
    expect(container.textContent).toBe("12 Sept 2026")
    expect(container.textContent).toBe(formatDay(NEAR_MIDNIGHT))
  })
})
