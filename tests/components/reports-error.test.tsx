import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  usePathname: () => "/reports",
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
}))

import ReportsError from "@/app/(dashboard)/reports/error"

afterEach(() => {
  replace.mockClear()
  window.history.replaceState(null, "", "/")
})

describe("reports error boundary", () => {
  it("is the shared error state: one alert, a short sentence, Try again", async () => {
    const reset = vi.fn()
    const { container } = render(
      <ReportsError error={new Error("boom")} reset={reset} />
    )
    expect(container.querySelector("[data-slot='page-frame']")).toHaveAttribute(
      "data-width",
      "wide"
    )
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Reports hit an error")
    const sentence = "Nothing was changed. Your listings are safe."
    expect(alert).toHaveTextContent(sentence)
    expect(sentence.length).toBeLessThanOrEqual(44)
    expect(alert).not.toContainElement(
      screen.getByRole("button", { name: "Try again" })
    )
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it("goes back to the whole report, keeping the scope and dropping the report's choices", async () => {
    window.history.replaceState(
      null,
      "",
      "/reports?clientId=c1&locationId=l1&tab=google&range=90d"
    )
    const reset = vi.fn()
    render(<ReportsError error={new Error("boom")} reset={reset} />)
    // A button, not a link: the boundary outlives navigations on /reports.
    expect(screen.queryByRole("link", { name: "Whole report" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Whole report" }))
    expect(replace).toHaveBeenCalledWith("/reports?clientId=c1")
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it("goes to the plain report when there is no client in the address", async () => {
    window.history.replaceState(null, "", "/reports?tab=keywords")
    render(<ReportsError error={new Error("boom")} reset={vi.fn()} />)
    await userEvent.click(screen.getByRole("button", { name: "Whole report" }))
    expect(replace).toHaveBeenCalledWith("/reports")
  })
})
