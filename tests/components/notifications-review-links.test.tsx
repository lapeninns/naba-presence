import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NotificationsView } from "@/components/notifications/notifications-view"
import type { NotificationItem } from "@/lib/contracts/operational-notifications"
import { parseInboxState } from "@/lib/inbox/url-state"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/notifications",
  useSearchParams: () => new URLSearchParams(),
}))

const LOCATION = "11111111-1111-4111-8111-111111111111"
const REVIEW = "33333333-3333-4333-8333-333333333333"
const CASES = [
  {
    kind: "approval_requested",
    label: "Approval requested",
    icon: "clipboard-check",
    href: `/inbox?queue=approval&selected=${REVIEW}`,
    queue: "approval",
  },
  {
    kind: "reply_sent_back",
    label: "Reply sent back",
    icon: "undo-2",
    href: `/inbox?selected=${REVIEW}`,
    queue: "needs_reply",
  },
] as const

function notification(
  overrides: Partial<NotificationItem> = {}
): NotificationItem {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    kind: "approval_requested",
    subjectType: "review",
    // Producers identify the subject by organisation and review; routing uses
    // the reviewId in summary, rather than this compound subject id.
    subjectId: `44444444-4444-4444-8444-444444444444:review:${REVIEW}`,
    locationId: LOCATION,
    locationName: "Old Crown",
    status: "open",
    reason: null,
    summary: { title: "Old Crown", locationId: LOCATION, reviewId: REVIEW },
    openedAt: "2026-10-18T10:00:00.000Z",
    lastSeenAt: "2026-10-18T10:00:00.000Z",
    resolvedAt: null,
    readAt: null,
    canResolve: true,
    ...overrides,
  }
}

function renderNotification(item: NotificationItem, usageHref?: string) {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          items: [item],
          nextCursor: null,
          unreadCount: item.status === "open" && !item.readAt ? 1 : 0,
        }),
        { headers: { "content-type": "application/json" } }
      )
  )
  vi.stubGlobal("fetch", fetchMock)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <NotificationsView usageHref={usageHref} />
    </QueryClientProvider>
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe("notification review links", () => {
  it.each(CASES)(
    "opens $kind in its Inbox queue with its own row icon",
    async ({ kind, label, icon, href, queue }) => {
      const fetchMock = renderNotification(notification({ kind }))
      const link = await screen.findByRole("link", {
        name: `Open review for ${label}`,
      })
      expect(link).toHaveTextContent("Open review")
      expect(link).toHaveAttribute("href", href)
      // Exercise the real destination parser as well as the literal URL: a
      // mistyped queue would silently fall back to Needs reply.
      const destination = new URL(
        link.getAttribute("href")!,
        "https://app.test"
      )
      expect(destination.pathname).toBe("/inbox")
      expect(parseInboxState(destination.searchParams)).toMatchObject({
        queue,
        selected: REVIEW,
      })
      const glyph = link.closest("li")?.querySelector(`svg.lucide-${icon}`)
      expect(glyph).toBeInTheDocument()
      expect(glyph?.closest('[aria-hidden="true"]')).not.toBeNull()
      expect(
        screen.queryByRole("link", { name: `Open listing for ${label}` })
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: `Mark read: ${label}` })
      ).toBeInTheDocument()
      expect(screen.getByRole("status")).toHaveTextContent("1 open and unread")

      // Prevent jsdom navigation, then activate the real link: opening a
      // review must not implicitly mark the notification read or resolve it.
      link.addEventListener("click", (event) => event.preventDefault())
      fireEvent.click(link)
      expect(fetchMock.mock.calls).toHaveLength(1)
      expect(
        screen.getByRole("button", { name: `Mark read: ${label}` })
      ).toBeInTheDocument()
      expect(screen.getByRole("status")).toHaveTextContent("1 open and unread")
    }
  )

  describe.each(CASES)("$kind metadata fallback", ({ kind, label, href }) => {
    it.each([
      { name: "missing review id", summary: {} },
      { name: "null review id", summary: { reviewId: null } },
      { name: "non-string review id", summary: { reviewId: 123 } },
      {
        name: "malformed review id",
        summary: { reviewId: "../settings?queue=all&selected=other" },
      },
    ])("keeps Open listing for a $name", async ({ summary }) => {
      renderNotification(notification({ kind, summary }))
      expect(
        await screen.findByRole("link", { name: `Open listing for ${label}` })
      ).toHaveAttribute("href", `/listings/${LOCATION}`)
      expect(
        screen.queryByRole("link", { name: /Open review/ })
      ).not.toBeInTheDocument()
    })

    it("still opens a resolved, read notification's review without a listing id", async () => {
      // Notifications may outlive the original approval state. Keep the
      // review destination; the Inbox reads its current state and access.
      renderNotification(
        notification({
          kind,
          locationId: null,
          locationName: null,
          summary: { reviewId: REVIEW },
          status: "resolved",
          resolvedAt: "2026-10-18T10:05:00.000Z",
          readAt: "2026-10-18T10:05:00.000Z",
          canResolve: false,
        })
      )
      expect(
        await screen.findByRole("link", { name: `Open review for ${label}` })
      ).toHaveAttribute("href", href)
      expect(
        screen.getByRole("button", { name: `Mark unread: ${label}` })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: `Resolve: ${label}` })
      ).not.toBeInTheDocument()
      expect(screen.getByRole("status")).toHaveTextContent("0 open and unread")
    })

    it("offers no target link when neither a review nor a listing id is available", async () => {
      renderNotification(
        notification({
          kind,
          locationId: null,
          locationName: null,
          summary: {},
        })
      )
      expect(await screen.findByText(label)).toBeInTheDocument()
      expect(
        screen.queryByRole("link", { name: /Open (review|listing)/ })
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: `Mark read: ${label}` })
      ).toBeInTheDocument()
    })
  })

  it("preserves other kinds' listing destination and icon even with review metadata", async () => {
    renderNotification(notification({ kind: "low_rating_review" }))
    const link = await screen.findByRole("link", {
      name: "Open listing for New low-rated review",
    })
    expect(link).toHaveAttribute("href", `/listings/${LOCATION}`)
    expect(
      link.closest("li")?.querySelector("svg.lucide-star")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: /Open review/ })
    ).not.toBeInTheDocument()
  })

  describe("account-level notifications", () => {
    const account = (kind: NotificationItem["kind"], summary = {}) =>
      notification({
        kind,
        subjectType: "google_connection",
        subjectId: "55555555-5555-4555-8555-555555555555",
        locationId: null,
        locationName: null,
        summary,
        canResolve: false,
      })

    it.each([
      {
        kind: "connection_reconnect",
        label: "Google login needs reconnecting",
        link: "Open Google connections",
        href: "/settings/connections",
      },
      {
        kind: "connection_owner_left",
        label: "Connection owner left",
        link: "Open Google connections",
        href: "/settings/connections",
      },
      {
        kind: "ai_credits_low",
        label: "AI reply credits running low",
        link: "See AI credits",
        href: "/settings/usage",
      },
      {
        kind: "ai_credits_exhausted",
        label: "AI reply credits used up",
        link: "See AI credits",
        href: "/settings/usage",
      },
    ] as const)(
      "links $kind to where it is fixed",
      async ({ kind, label, link, href }) => {
        renderNotification(account(kind), "/settings/usage")
        const target = await screen.findByRole("link", {
          name: `${link} for ${label}`,
        })
        expect(target).toHaveTextContent(link)
        expect(target).toHaveAttribute("href", href)
        expect(
          screen.queryByRole("link", { name: /Open (review|listing)/ })
        ).not.toBeInTheDocument()
      }
    )

    it("sends AI credits to Reply policy when no Usage page is given", async () => {
      renderNotification(account("ai_credits_low"))
      expect(
        await screen.findByRole("link", {
          name: "See AI credits for AI reply credits running low",
        })
      ).toHaveAttribute("href", "/settings/policy")
    })

    it("names the Google login a connection notification is about", async () => {
      renderNotification(
        account("connection_reconnect", { googleEmail: "ops@venue.co.uk" })
      )
      expect(await screen.findByText("ops@venue.co.uk")).toBeInTheDocument()
    })

    it("names no login for the credit kinds", async () => {
      renderNotification(
        account("ai_credits_low", { googleEmail: "ops@venue.co.uk" })
      )
      await screen.findByText("AI reply credits running low")
      expect(screen.queryByText("ops@venue.co.uk")).not.toBeInTheDocument()
    })
  })
})
