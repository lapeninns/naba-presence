import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  usePathname: () => "/clients",
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import ClientsError from "@/app/(dashboard)/clients/error"

describe("clients error boundary", () => {
  it("is the shared error state: one alert, a short sentence, Try again", async () => {
    const reset = vi.fn()
    const { container } = render(
      <ClientsError error={new Error("boom")} reset={reset} />
    )
    // It stands in for the page's own wide frame.
    expect(container.querySelector("[data-slot='page-frame']")).toHaveAttribute(
      "data-width",
      "wide"
    )
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("This client page hit an error")
    const sentence = "Nothing was changed. Your clients are safe."
    expect(alert).toHaveTextContent(sentence)
    expect(sentence.length).toBeLessThanOrEqual(44)
    expect(alert).not.toContainElement(
      screen.getByRole("button", { name: "Try again" })
    )
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it("goes back to all clients by dropping the filters from the address and resetting", async () => {
    replace.mockClear()
    const reset = vi.fn()
    render(<ClientsError error={new Error("boom")} reset={reset} />)
    // A button, not a link: the boundary outlives navigations on /clients.
    expect(screen.queryByRole("link", { name: "All clients" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "All clients" }))
    expect(replace).toHaveBeenCalledWith("/clients")
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
