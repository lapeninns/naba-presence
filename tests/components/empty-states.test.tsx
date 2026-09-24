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
  it("distinguishes checked-and-empty from filtered-out from disconnected", () => {
    const { rerender } = render(
      <EmptyState
        reason="checked"
        counts={{
          running: 0,
          failed: 0,
          succeeded: 2,
          notStarted: 0,
          lastSyncAt: null,
        }}
      />
    )
    expect(screen.getByText("No reviews yet.")).toBeInTheDocument()

    rerender(<EmptyState reason="filtered" onClear={() => {}} />)
    expect(
      screen.getByText("No reviews match these filters.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Clear filters" })
    ).toBeInTheDocument()

    // This state carries the whole message now. It used to defer the headline
    // and the link to the shell's ReconnectBanner, but that banner is
    // client-scoped and the inbox is organisation-wide, so on this screen
    // there is nothing else to defer to.
    rerender(<EmptyState reason="disconnected" />)
    expect(screen.getByText("Google is not connected.")).toBeInTheDocument()
    expect(
      screen.getByText("Reconnect Google to sync and reply to your reviews.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Manage connection" })
    ).toHaveAttribute("href", "/settings/connections")
  })

  it.each([
    ["failed", "No failed publishes."],
    ["approval", "Nothing is waiting for approval."],
    ["awaiting_my_approval", "Nothing is waiting for approval."],
    ["publishing", "Nothing is on its way to Google."],
    ["done", "Nothing published yet."],
    ["needs_reply", "Nothing needs a reply."],
  ] as const)("words an empty %s queue as that queue", (queue, title) => {
    render(<EmptyState reason="queue_empty" queue={queue} />)
    expect(screen.getByText(title)).toBeInTheDocument()
  })

  it("offers the next queue with work in it", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <EmptyState
        reason="queue_empty"
        queue="failed"
        nextQueue={{ label: "Needs reply", count: 4, onSelect }}
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Go to Needs reply (4)" })
    )
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("sends an owner or admin straight to adding a first client", () => {
    render(<EmptyState reason="no_clients" canManageClients />)
    expect(screen.getByRole("link", { name: "Add a client" })).toHaveAttribute(
      "href",
      "/clients/new"
    )
  })

  it("tells a member who can add a client instead of linking to a page they cannot use", () => {
    render(<EmptyState reason="no_clients" />)
    expect(screen.getByText(/Ask an owner or admin/)).toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("clears filters on request", async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<EmptyState reason="filtered" onClear={onClear} />)
    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("never promises reviews will arrive when no import has run", () => {
    // The old copy said this for every empty list: "New Google reviews will
    // appear here as they arrive." Nothing arrives until an import runs, so
    // for a linked-but-never-imported location it was a promise the product
    // could not keep.
    render(
      <EmptyState
        reason="never_imported"
        counts={{
          running: 0,
          failed: 0,
          succeeded: 0,
          notStarted: 3,
          lastSyncAt: null,
        }}
      />
    )
    expect(
      screen.getByText("No reviews have been imported yet.")
    ).toBeInTheDocument()
    expect(screen.queryByText(/will appear here as they arrive/i)).toBeNull()
  })

  it("says an import is waiting without claiming it is running", () => {
    // /api/clients counts pending and running checkpoints together, so a
    // queued import cannot be told from a live one here. The copy has to hold
    // for both.
    render(
      <EmptyState
        reason="importing"
        counts={{
          running: 2,
          failed: 0,
          succeeded: 0,
          notStarted: 0,
          lastSyncAt: null,
        }}
      />
    )
    expect(screen.getByText("Reviews are still coming in.")).toBeInTheDocument()
    expect(
      screen.getByText(/2 locations are waiting on Google/)
    ).toBeInTheDocument()
  })

  it("dates the claim when it says Google has none", () => {
    render(
      <EmptyState
        reason="checked"
        counts={{
          running: 0,
          failed: 0,
          succeeded: 1,
          notStarted: 0,
          lastSyncAt: "2026-09-04T06:00:00.000Z",
        }}
      />
    )
    // Never a bare present-tense assertion about Google: it says when we last
    // asked, because that is the part the app can actually vouch for.
    expect(
      screen.getByText(
        /Google had none for these locations when we last checked/
      )
    ).toBeInTheDocument()
  })

  it("offers a way out of every state the operator can act on", () => {
    for (const reason of [
      "not_connected",
      "import_failed",
      "never_imported",
    ] as const) {
      const { unmount } = render(<EmptyState reason={reason} />)
      expect(
        screen.getByRole("link", { name: "Manage connection" })
      ).toHaveAttribute("href", "/settings/connections")
      unmount()
    }
  })
})
