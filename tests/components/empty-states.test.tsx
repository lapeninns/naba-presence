import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { EmptyState } from "@/components/inbox/empty-states"

afterEach(() => vi.restoreAllMocks())

describe("EmptyState", () => {
  it("distinguishes no-data from filtered-out from disconnected", () => {
    const { rerender } = render(<EmptyState kind="no-data" />)
    expect(screen.getByText("No reviews yet")).toBeInTheDocument()

    rerender(<EmptyState kind="filtered" onClear={() => {}} />)
    expect(screen.getByText("No reviews match these filters")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument()

    // This state carries the whole message now. It used to defer the headline
    // and the link to the shell's ReconnectBanner, but that banner is
    // client-scoped and the inbox is organisation-wide, so on this screen
    // there is nothing else to defer to.
    rerender(<EmptyState kind="disconnected" />)
    expect(screen.getByText("Google is not connected")).toBeInTheDocument()
    expect(
      screen.getByText("Reconnect Google to sync and reply to your reviews.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Manage connection" })
    ).toHaveAttribute("href", "/settings/connections")
  })

  it("clears filters on request", async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<EmptyState kind="filtered" onClear={onClear} />)
    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
