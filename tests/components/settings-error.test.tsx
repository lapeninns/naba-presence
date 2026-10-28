import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

const { pathState } = vi.hoisted(() => ({
  pathState: { current: "/settings" as string | null },
}))

vi.mock("next/navigation", () => ({
  usePathname: () => pathState.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import SettingsError from "@/app/(dashboard)/settings/error"

const renderAt = (path: string | null) => {
  pathState.current = path
  const reset = vi.fn()
  render(<SettingsError error={new Error("boom")} reset={reset} />)
  return reset
}

describe("settings error boundary", () => {
  it("goes back up to Settings from a settings area", async () => {
    const reset = renderAt("/settings/notifications")
    expect(
      screen.getByRole("link", { name: "Back to Settings" })
    ).toHaveAttribute("href", "/settings")
    expect(screen.queryByRole("link", { name: "Go to Inbox" })).toBeNull()
    expect(
      screen.getByText(/Try again, or go back to Settings\.$/)
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it("keeps the Inbox on /settings itself, where Settings would reload the error", () => {
    renderAt("/settings")
    expect(screen.getByRole("link", { name: "Go to Inbox" })).toHaveAttribute(
      "href",
      "/inbox"
    )
    expect(screen.queryByRole("link", { name: "Back to Settings" })).toBeNull()
    expect(
      screen.getByText(/Try again, or go back to the Inbox\.$/)
    ).toBeInTheDocument()
  })

  it("keeps the Inbox when the path is not known", () => {
    renderAt(null)
    expect(
      screen.getByRole("link", { name: "Go to Inbox" })
    ).toBeInTheDocument()
  })
})
