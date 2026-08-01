import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "@/components/app-shell/app-shell"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { QueryProvider } from "@/lib/queries/provider"

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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

  it("opens the mobile nav sheet at the intended 256px width", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: "Open navigation" }))
    const dialog = await screen.findByRole("dialog", { name: "Navigation" })
    // The Sheet variant's base classes ship `data-[side=left]:w-3/4`, and
    // twMerge cannot dedupe that against a bare `w-64` override - different
    // variant scope, so both land in the compiled output and the
    // data-attribute selector wins on specificity. The override must use
    // the same `data-[side=left]:` prefix to actually replace it.
    expect(dialog).toHaveClass("data-[side=left]:w-64")
    expect(dialog).not.toHaveClass("w-64")
  })
})

describe("session-ready children gate", () => {
  it("holds routed children until the bootstrap session cookie resolves, then renders them", async () => {
    // No `session` prop (the local-bootstrap, first-anonymous-visit path):
    // `useSessionReady` starts `ready = false` and fires `GET /api/session`
    // to provision the cookie. Route URL-aware so the *later*, gated
    // `useConnectionHealth` query (mounted only once the gate opens) gets a
    // valid `{ connections: [] }` body instead of the bootstrap's session
    // shape - an accidental mismatch there would throw inside `StatusChip`
    // and take the whole tree down with it, hiding the very assertion this
    // test exists to make.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/session")) {
        return new Response(JSON.stringify({ session }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      return new Response(JSON.stringify({ connections: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <QueryProvider>
        <AppShell session={null}>
          <div>gated-child</div>
        </AppShell>
      </QueryProvider>
    )

    // Synchronous assertion, before the bootstrap fetch's promise settles:
    // the gate must hold and the routed content must not be in the DOM yet.
    expect(screen.queryByText("gated-child")).not.toBeInTheDocument()

    // Once `/api/session` resolves, `sessionReady` flips true and the gate
    // opens.
    await waitFor(() =>
      expect(screen.getByText("gated-child")).toBeInTheDocument()
    )
  })

  it("bootstraps the session with an abortable request", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}", { status: 200 })
    )
    vi.stubGlobal("fetch", fetchMock)
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

describe("sign out", () => {
  it("clears the session then leaves the app", async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    const signOutSpy = vi
      .spyOn(await import("@/lib/api/auth"), "signOut")
      .mockResolvedValue(undefined)
    renderShell()
    await user.click(screen.getByRole("button", { name: "Sign out" }))
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
    await user.click(screen.getByRole("button", { name: "Sign out" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sign-in"))
  })
})
