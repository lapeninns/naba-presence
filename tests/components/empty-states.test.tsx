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
    // One name for clearing everything, as the chips and the sheet say it.
    expect(
      screen.getByRole("button", { name: "Clear all filters" })
    ).toBeInTheDocument()

    // This state carries the whole message now. It used to defer the headline
    // and the link to the shell's ReconnectBanner, but that banner is
    // client-scoped and the inbox is organisation-wide, so on this screen
    // there is nothing else to defer to.
    rerender(<EmptyState reason="disconnected" canManageClients />)
    expect(screen.getByText("Google is not connected.")).toBeInTheDocument()
    expect(
      screen.getByText("Reconnect Google to sync and reply to your reviews.")
    ).toBeInTheDocument()
    // The label says what the page is for here (it was "Manage
    // connection"); the destination is unchanged.
    expect(
      screen.getByRole("link", { name: "Reconnect Google" })
    ).toHaveAttribute("href", "/settings/connections")
    expect(
      screen.queryByRole("link", { name: "Manage connection" })
    ).not.toBeInTheDocument()
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

  it("says an empty Needs reply is all caught up only when no queue has work", () => {
    const { rerender } = render(
      <EmptyState reason="queue_empty" queue="needs_reply" />
    )
    expect(screen.getByText(/You’re all caught up\./)).toBeInTheDocument()

    rerender(
      <EmptyState
        reason="queue_empty"
        queue="needs_reply"
        nextQueue={{ label: "Approval", count: 1, onSelect: () => {} }}
      />
    )
    expect(screen.queryByText(/all caught up/)).not.toBeInTheDocument()
    // The button says where the work is; the copy does not repeat it.
    expect(screen.queryByText(/Choose another queue/)).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Go to Approval (1)" })
    ).toBeInTheDocument()
  })

  it("tells an approver how many replies wait for them, and takes them there", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <EmptyState
        reason="queue_empty"
        queue="needs_reply"
        nextQueue={{ label: "Approval", count: 3, onSelect: () => {} }}
        approvalsWaiting={{ count: 2, onSelect }}
      />
    )
    expect(screen.getByText("Nothing needs a reply.")).toBeInTheDocument()
    expect(
      screen.getByText("2 replies are waiting for your approval.")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^Go to/ })
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Review your approvals (2)" })
    )
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("names the search and the queue when a search alone matches nothing", async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(
      <EmptyState
        reason="filtered"
        onClear={onClear}
        filtered={{
          search: "parking",
          searchOnly: true,
          queueLabel: "Needs reply",
          queueTotal: 2,
        }}
      />
    )
    expect(screen.getByText("No reviews match “parking”")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Nothing in Needs reply matches. Try other words, or choose another queue above. Your search stays."
      )
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Clear search" }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("says how many the queue holds when filters match none of them", () => {
    render(
      <EmptyState
        reason="filtered"
        onClear={() => {}}
        filtered={{
          searchOnly: false,
          queueLabel: "Needs reply",
          queueTotal: 2,
        }}
      />
    )
    expect(
      screen.getByText("No reviews match these filters.")
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Needs reply has 2 reviews, but none match. Remove a filter above, or clear them all."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Clear all filters" })
    ).toBeInTheDocument()
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
    await user.click(screen.getByRole("button", { name: "Clear all filters" }))
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
      const { unmount } = render(
        <EmptyState reason={reason} canManageClients />
      )
      expect(
        screen.getByRole("link", { name: "Manage connection" })
      ).toHaveAttribute("href", "/settings/connections")
      unmount()
    }
  })

  // /settings/connections is owners and admins only, so a member or viewer
  // keeps the explanation, is told who to ask and gets no button (INB-06).
  it("sends members and viewers to an owner or admin, not to Access denied", () => {
    for (const reason of [
      "disconnected",
      "not_connected",
      "import_failed",
      "never_imported",
    ] as const) {
      const { container, unmount } = render(
        <EmptyState
          reason={reason}
          counts={{
            running: 0,
            failed: 1,
            succeeded: 0,
            notStarted: 1,
            lastSyncAt: null,
          }}
        />
      )
      expect(screen.queryByRole("link")).not.toBeInTheDocument()
      expect(screen.queryByRole("button")).not.toBeInTheDocument()
      expect(container).toHaveTextContent(/Ask an owner or admin/)
      unmount()
    }
  })

  it("titles every state with an h2 at weight 600", () => {
    render(<EmptyState reason="checked" />)
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "No reviews yet.",
    })
    // The Empty primitive's own title weight: text-title at 600 (taste P4).
    expect(heading).toHaveClass("text-title", "font-semibold")
  })

  it.each([
    ["queue_empty", "needs_reply"],
    ["queue_empty", "done"],
    ["checked", undefined],
    ["no_clients", undefined],
    ["disconnected", undefined],
    ["not_connected", undefined],
    ["never_imported", undefined],
    ["importing", undefined],
    ["import_failed", undefined],
  ] as const)(
    "draws a hidden line illustration for %s (%s), in place of the mark",
    (reason, queue) => {
      const { container } = render(<EmptyState reason={reason} queue={queue} />)
      // The Empty primitive's illustration slot, holding our line art.
      const slot = container.querySelector('[data-slot="empty-illustration"]')
      expect(slot).toBeInTheDocument()
      expect(slot).toHaveAttribute("aria-hidden", "true")
      expect(slot).toHaveClass("text-ink")
      const art = slot?.querySelector("svg")
      expect(art).toHaveAttribute("stroke", "currentColor")
      expect(art).toHaveAttribute("stroke-width", "1.5")
      // Colour comes from ink tokens, never a literal.
      expect(slot?.outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i)
      // One drawing, not a drawing and a mark.
      expect(
        container.querySelector(
          '[data-slot="empty"] > span[aria-hidden]:not([data-slot="empty-illustration"])'
        )
      ).toBeNull()
    }
  )

  it.each(["filtered", "unknown"] as const)(
    "keeps the small mark and no illustration for %s",
    (reason) => {
      const { container } = render(
        <EmptyState reason={reason} onClear={() => {}} />
      )
      expect(
        container.querySelector('[data-slot="empty-illustration"]')
      ).toBeNull()
      expect(
        container.querySelector('[data-slot="empty"] > span[aria-hidden] svg')
      ).toBeInTheDocument()
    }
  )

  it.each(["disconnected", "import_failed"] as const)(
    "gives the %s problem a danger mark that is a shape, not only a colour",
    (reason) => {
      const { container } = render(<EmptyState reason={reason} />)
      expect(container.querySelector('[data-slot="empty"]')).toHaveAttribute(
        "data-tone",
        "bad"
      )
      const mark = container.querySelector(
        '[data-slot="empty-illustration"] .text-danger-ink'
      )
      expect(mark?.querySelector("circle")).toBeInTheDocument()
      expect(mark?.querySelectorAll("path").length).toBeGreaterThanOrEqual(2)
    }
  )
})
