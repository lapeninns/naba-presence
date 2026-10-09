import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { push, session } = vi.hoisted(() => ({
  push: vi.fn(),
  session: { role: "owner" },
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("@/lib/server/session", () => ({ getSession: async () => session }))

import NewClientPage from "@/app/(dashboard)/clients/new/page"
import { Toaster } from "@/components/ui/toast"

const client = {
  id: "c1",
  name: "Test Group",
  slug: "test-group",
  colour: null,
  logoUrl: null,
  notes: null,
  archivedAt: null,
  createdAt: "2026-01-01",
  locationCount: 0,
  linkedCount: 0,
  verifiedCount: 0,
  health: "healthy",
  connections: [],
  openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
  backfill: { running: 0, failed: 0, succeeded: 0, notStarted: 0 },
  lastSyncAt: null,
}
const queries: QueryClient[] = []
async function mount(listing?: string | string[]) {
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  queries.push(query)
  const page = await NewClientPage({
    searchParams: Promise.resolve({ listing }),
  })
  render(
    <QueryClientProvider client={query}>
      <Toaster>{page}</Toaster>
    </QueryClientProvider>
  )
}
afterEach(() => {
  queries.forEach((query) => query.clear())
  queries.length = 0
  vi.unstubAllGlobals()
  push.mockReset()
  session.role = "owner"
})

describe("New client listing return", () => {
  it("returns to the listing only after an explicit create and does not assign automatically", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ client }), { status: 200 })
      )
    vi.stubGlobal("fetch", fetcher)
    await mount("l1")
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/listings/l1"
    )
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole("textbox", { name: "Client name" }), {
      target: { value: "Test Group" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create client" }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/listings/l1"))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/clients")
  })
  it("keeps normal creation in the existing setup flow", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ client }), { status: 200 })
        )
    )
    await mount()
    fireEvent.change(screen.getByRole("textbox", { name: "Client name" }), {
      target: { value: "Test Group" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create client" }))
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/setup?client=c1&step=connect")
    )
  })
  it.each(["viewer", "member"])(
    "does not grant %s access to create via return context",
    async (role) => {
      session.role = role
      await mount("l1")
      expect(
        screen.queryByRole("form", { name: "New client" })
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole("heading", { name: /don’t have access/i })
      ).toBeInTheDocument()
    }
  )
  it.each(["https://evil.test", "../settings", ["l1", "l2"]])(
    "ignores invalid listing return context %s",
    async (listing) => {
      await mount(listing)
      expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
        "href",
        "/clients"
      )
    }
  )
})
