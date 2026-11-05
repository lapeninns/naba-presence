import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import InboxError from "@/app/(dashboard)/inbox/error"
import InboxLoading from "@/app/(dashboard)/inbox/loading"

describe("inbox loading outline", () => {
  it("says it is loading in words, inside one busy status", () => {
    render(<InboxLoading />)
    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveTextContent("Loading reviews")
  })

  it("keeps the document titled while the page streams in", () => {
    render(<InboxLoading />)
    expect(document.title).toBe("Inbox · NabaPresence")
  })

  it("outlines the six queue tabs and puts each row's pill where the row will", () => {
    const { container } = render(<InboxLoading />)
    expect(container.querySelectorAll(".h-11.desk\\:h-10")).toHaveLength(6)
    const trailing = container.querySelectorAll(
      '[data-slot="review-rows-skeleton"] [data-slot="list-row-trailing"]'
    )
    expect(trailing.length).toBeGreaterThan(0)
    for (const slot of trailing)
      expect(slot).toHaveAttribute("data-placement", "adaptive")
  })
})

describe("inbox error boundary", () => {
  it("is the shared error state: one alert, a short sentence, Try again", async () => {
    const reset = vi.fn()
    render(<InboxError error={new Error("boom")} reset={reset} />)
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("The inbox hit an error")
    const sentence = "Nothing was changed. Your drafts are safe."
    expect(alert).toHaveTextContent(sentence)
    // The empty-state rule: one sentence of at most 44 characters.
    expect(sentence.length).toBeLessThanOrEqual(44)
    // The actions sit outside the alert, so it announces only what happened.
    expect(alert).not.toContainElement(
      screen.getByRole("button", { name: "Try again" })
    )
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it("goes back to the list by dropping the review from the URL and resetting", async () => {
    replace.mockClear()
    const reset = vi.fn()
    render(<InboxError error={new Error("boom")} reset={reset} />)
    // A button, not a link: the boundary outlives navigations on /inbox.
    expect(screen.queryByRole("link", { name: /Inbox/ })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Back to Inbox" }))
    expect(replace).toHaveBeenCalledWith("/inbox")
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
