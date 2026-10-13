import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { ShellNotices } from "@/components/app-shell/shell-notices"

// One region for the shell's standing notices: while collapsed only the
// first filled slot shows (the rest are hidden by CSS, which jsdom does not
// apply, so the collapse class is what is asserted), and "+N more" reveals
// the rest. Each notice keeps its own rules for whether it renders.

const COLLAPSE_CLASS =
  "[&>[data-notice]:has(>:not(:empty))~[data-notice]]:hidden"

function region() {
  return document.querySelector<HTMLElement>('[data-slot="shell-notices"]')!
}
function list() {
  return document.querySelector<HTMLElement>('[data-slot="notice-list"]')!
}

function Notices({
  impersonation = false,
  reconnect = false,
  billing = false,
}: {
  impersonation?: boolean
  reconnect?: boolean
  billing?: boolean
}) {
  return (
    <ShellNotices>
      {impersonation ? <div role="status">Acting as support</div> : null}
      {/* A notice that decided not to show can leave an empty wrapper. */}
      {reconnect ? <div role="alert">Google stopped accepting</div> : <div />}
      {billing ? <div role="status">Your trial ends soon</div> : null}
    </ShellNotices>
  )
}

describe("ShellNotices", () => {
  it("shows one notice and offers the second behind +1 more notice", async () => {
    const user = userEvent.setup()
    render(<Notices impersonation reconnect />)
    const more = await screen.findByRole("button", { name: "+1 more notice" })
    expect(region()).toHaveAttribute("data-count", "2")
    expect(more).toHaveAttribute("aria-expanded", "false")
    expect(more).toHaveAttribute("aria-controls", list().id)
    expect(list()).toHaveClass(COLLAPSE_CLASS)

    await user.click(more)
    expect(
      screen.getByRole("button", { name: "Show fewer notices" })
    ).toHaveAttribute("aria-expanded", "true")
    expect(list()).not.toHaveClass(COLLAPSE_CLASS)
    // Every notice keeps its content and its own role.
    expect(screen.getByRole("status")).toHaveTextContent("Acting as support")
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Google stopped accepting"
    )
  })

  it("counts every hidden notice and skips empty slots", async () => {
    render(<Notices impersonation reconnect billing />)
    expect(
      await screen.findByRole("button", { name: "+2 more notices" })
    ).toBeInTheDocument()
    expect(region()).toHaveAttribute("data-count", "3")
  })

  it("has no disclosure for a single notice, wherever its slot is", async () => {
    render(<Notices billing />)
    await act(async () => {})
    expect(region()).toHaveAttribute("data-count", "1")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("collapses again once the extra notices resolve", async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Notices impersonation reconnect />)
    await user.click(
      await screen.findByRole("button", { name: "+1 more notice" })
    )
    await act(async () => rerender(<Notices impersonation />))
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    await act(async () => rerender(<Notices impersonation billing />))
    expect(
      await screen.findByRole("button", { name: "+1 more notice" })
    ).toHaveAttribute("aria-expanded", "false")
  })
})
