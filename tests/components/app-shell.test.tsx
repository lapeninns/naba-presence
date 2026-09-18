import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "@/components/app-shell/app-shell"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { QueryProvider } from "@/lib/queries/provider"

const push = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  push.mockReset()
})

const session = {
  sessionId: "s",
  userId: "u",
  organisationId: "o",
  organisationName: "Lapen Inns Agency",
  displayName: "Aman Shrestha",
  email: "a@example.test",
  role: "owner" as const,
  canPublish: true,
}

const client = {
  id: "c1",
  name: "Old Crown Group",
  slug: "old-crown-group",
  colour: null,
  logoUrl: null,
  notes: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  locationCount: 3,
  linkedCount: 3,
  verifiedCount: 2,
  health: "healthy" as const,
  connections: [],
  openWork: { needsReply: 4, awaitingApproval: 1, failed: 0 },
  backfill: { running: 0, failed: 0, succeeded: 3, notStarted: 0 },
  lastSyncAt: "2026-09-03T10:00:00.000Z",
}

function stubApi(overrides: { clients?: unknown[] } = {}) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    const body = url.includes("/api/clients")
      ? { items: overrides.clients ?? [client], unassignedLocationCount: 0 }
      : url.includes("/api/organisations")
        ? { items: [{ organisationId: "o", name: "Lapen Inns Agency", role: "owner" }] }
        : url.includes("/api/session")
          ? { session }
          : { locations: [] }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function renderShell() {
  stubApi()
  return render(
    <QueryProvider>
      <AppShell session={session}>
        <PageFrame>
          <PageHeader title="Inbox" description="Every review" />
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

  it("renders exactly one main and one h1", () => {
    renderShell()
    expect(screen.getAllByRole("main")).toHaveLength(1)
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
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

  it("names the agency and the signed-in person without fetching either", () => {
    renderShell()
    expect(screen.getByText("Lapen Inns Agency")).toBeInTheDocument()
    expect(screen.getByText("Aman Shrestha")).toBeInTheDocument()
  })

  it("pins the agency's clients into the sidebar", async () => {
    renderShell()
    expect(
      await screen.findByRole("link", { name: /Old Crown Group/ })
    ).toHaveAttribute("href", "/clients/c1")
  })

  it("reports health as a count, not a single worst-case word", async () => {
    stubApi({
      clients: [
        client,
        { ...client, id: "c2", name: "Harbour Kitchen", health: "disconnected" },
        { ...client, id: "c3", name: "Bella Vita", health: "attention" },
      ],
    })
    render(
      <QueryProvider>
        <AppShell session={session}>
          <PageFrame>
            <PageHeader title="Inbox" />
          </PageFrame>
        </AppShell>
      </QueryProvider>
    )
    // "2 clients need attention" tells an agency where to look. The old chip
    // said only "disconnected" whenever any connection anywhere was down.
    expect(await screen.findByText("2 clients need attention")).toBeInTheDocument()
  })

  it("offers a command palette from the topbar", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: /Commands/ }))
    expect(
      await screen.findByPlaceholderText("Go to a client, a location or an action…")
    ).toBeInTheDocument()
  })

  it("opens the mobile nav in a labelled sheet", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: "Open navigation" }))
    const dialog = await screen.findByRole("dialog", { name: "Navigation" })
    // The Sheet variant ships `data-[side=left]:w-3/4`, and twMerge cannot
    // dedupe that against a bare `w-72` override — different variant scope, so
    // both land in the output and the data-attribute selector wins. The
    // override must carry the same prefix to actually replace it.
    expect(dialog).toHaveClass("data-[side=left]:w-72")
  })
})

describe("session-ready children gate", () => {
  it("holds routed children until the bootstrap session cookie resolves", async () => {
    // No `session` prop: the local-bootstrap, first-anonymous-visit path.
    // `useSessionReady` starts closed and provisions the cookie first, so the
    // page's own queries cannot 401 and hard-navigate to /sign-in.
    stubApi()
    render(
      <QueryProvider>
        <AppShell session={null}>
          <div>gated-child</div>
        </AppShell>
      </QueryProvider>
    )
    expect(screen.queryByText("gated-child")).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText("gated-child")).toBeInTheDocument()
    )
  })

  it("bootstraps the session with an abortable request", async () => {
    const fetchMock = stubApi()
    render(
      <QueryProvider>
        <AppShell session={null}>content</AppShell>
      </QueryProvider>
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe("account menu", () => {
  it("explains what the role permits rather than showing a bare word", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: /Aman Shrestha/ }))
    expect(
      await screen.findByText(/Full access, including compliance and billing/)
    ).toBeInTheDocument()
  })

  it("clears the session then leaves the app", async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    const signOutSpy = vi
      .spyOn(await import("@/lib/api/auth"), "signOut")
      .mockResolvedValue(undefined)
    renderShell()
    await user.click(screen.getByRole("button", { name: /Aman Shrestha/ }))
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }))
    await waitFor(() => expect(signOutSpy).toHaveBeenCalled())
    expect(assign).toHaveBeenCalledWith("/sign-in")
  })

  it("still leaves the app when the sign-out request fails", async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    vi.spyOn(await import("@/lib/api/auth"), "signOut").mockRejectedValue(
      new Error("offline")
    )
    renderShell()
    await user.click(screen.getByRole("button", { name: /Aman Shrestha/ }))
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sign-in"))
  })

  it("hides the organisation switcher for someone who belongs to one", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: /Aman Shrestha/ }))
    await screen.findByRole("menuitem", { name: "Sign out" })
    expect(screen.queryByText("Switch organisation")).not.toBeInTheDocument()
  })
})
