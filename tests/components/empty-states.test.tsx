import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { EmptyState } from "@/components/inbox/empty-states"

afterEach(() => vi.restoreAllMocks())

describe("EmptyState", () => {
  it("distinguishes no-data from filtered-out from disconnected", () => {
    const { rerender } = render(<EmptyState kind="no-data" />)
    expect(screen.getByText("No reviews yet")).toBeInTheDocument()

    rerender(<EmptyState kind="filtered" onClear={() => {}} />)
    expect(screen.getByText("No reviews match these filters")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument()

    // The shell's ReconnectBanner renders on the same condition and owns the
    // "Google is not connected" headline and the Manage connection link, so
    // this state must NOT repeat either: it says only why the list is empty.
    rerender(<EmptyState kind="disconnected" />)
    expect(screen.getByText("No reviews to show")).toBeInTheDocument()
    expect(
      screen.getByText("Reconnect Google to sync and reply to your reviews.")
    ).toBeInTheDocument()
    expect(screen.queryByText("Google is not connected")).toBeNull()
    expect(
      screen.queryByRole("link", { name: "Manage connection" })
    ).toBeNull()
  })

  it("clears filters on request", async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<EmptyState kind="filtered" onClear={onClear} />)
    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
