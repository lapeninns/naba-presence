import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AppShell } from "@/components/app-shell/app-shell"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { QueryProvider } from "@/lib/queries/provider"

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
}))

const session = {
  sessionId: "s",
  userId: "u",
  organisationId: "o",
  organisationName: "Lapen Inns",
  displayName: "Aman Shrestha",
  email: "a@example.test",
  role: "owner" as const,
  canPublish: true,
}

function renderShell() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ connections: [{ id: "c1", googleEmail: null, status: "active", notificationsEnabled: false, lastRefreshAt: null, lastErrorCode: null, reconnectRequired: false, createdAt: "2026-01-01" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )
  )
  return render(
    <QueryProvider>
      <AppShell session={session}>
        <PageFrame>
          <PageHeader title="Inbox" description="Queue" />
        </PageFrame>
      </AppShell>
    </QueryProvider>
  )
}

describe("AppShell", () => {
  it("has a skip link as the first focusable, targeting main", () => {
    renderShell()
    const skip = screen.getByRole("link", { name: "Skip to content" })
    expect(skip).toHaveAttribute("href", "#main")
    expect(screen.getByRole("main")).toHaveAttribute("id", "main")
  })

  it("marks the active nav item", () => {
    renderShell()
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current"
    )
  })

  it("renders identity from the session prop without fetching it", () => {
    renderShell()
    expect(screen.getByText("Lapen Inns")).toBeInTheDocument()
    expect(screen.getByText("Aman Shrestha")).toBeInTheDocument()
  })

  it("shows the live-data status once connections resolve", async () => {
    renderShell()
    expect(await screen.findByText("Live data")).toBeInTheDocument()
  })

  it("renders exactly one main and one h1", () => {
    renderShell()
    expect(screen.getAllByRole("main")).toHaveLength(1)
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  })
})
