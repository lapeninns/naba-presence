import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/reports",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import DashboardError from "@/app/(dashboard)/error"
import GlobalError from "@/app/global-error"
import NotFound from "@/app/not-found"

describe("route error boundary", () => {
  it("names the failed area, shows the digest and retries", async () => {
    const retry = vi.fn()
    const reset = vi.fn()
    render(
      <DashboardError
        error={Object.assign(new Error("secret detail"), { digest: "d-123" })}
        reset={reset}
        unstable_retry={retry}
      />
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "Reports hit an error" })
    ).toBeInTheDocument()
    expect(screen.getByText("d-123")).toBeInTheDocument()
    // The message itself can carry details the viewer should not see.
    expect(screen.queryByText(/secret detail/)).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Back to Inbox" })).toHaveAttribute(
      "href",
      "/inbox"
    )
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(reset).not.toHaveBeenCalled()
    expect(screen.getAllByRole("main")).toHaveLength(1)
  })

  it("falls back to reset when retry is unavailable", async () => {
    const reset = vi.fn()
    render(<DashboardError error={new Error("x")} reset={reset} />)
    expect(screen.queryByText("Reference")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})

describe("root pages", () => {
  it("the root 404 has one main, one h1 and a way back in", () => {
    render(<NotFound />)
    expect(screen.getAllByRole("main")).toHaveLength(1)
    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Go to Inbox" })).toHaveAttribute(
      "href",
      "/inbox"
    )
  })

  it("the global error shows the digest in mono, never the message", () => {
    // global-error renders its own <html>; mount it into the document.
    render(
      <GlobalError
        error={Object.assign(new Error("secret detail"), { digest: "g-9" })}
        reset={vi.fn()}
      />,
      { container: document }
    )
    expect(screen.getByText("g-9").tagName).toBe("CODE")
    expect(screen.queryByText(/secret detail/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled()
  })
})
