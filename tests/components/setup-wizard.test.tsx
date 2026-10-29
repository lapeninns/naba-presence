import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const replace = vi.fn()
let search = new URLSearchParams("client=c1")
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/setup",
  useSearchParams: () => search,
}))
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// The keyboard-safety hook is the editors' own (tested in
// keep-focus-clear.test.tsx); here only its wiring to the step is checked.
const keepFocusClear = vi.hoisted(() => vi.fn())
vi.mock("@/lib/editors/use-keep-focus-clear", () => ({
  useKeepFocusClear: keepFocusClear,
}))

import { SetupWizard } from "@/components/setup/setup-wizard"
import type { ClientSetup, ClientSummary } from "@/lib/contracts/clients"
import { Toaster } from "@/components/ui/toast"
import { QueryProvider } from "@/lib/queries/provider"

const client: ClientSummary = {
  id: "c1",
  name: "Old Crown Group",
  slug: "old-crown-group",
  colour: null,
  logoUrl: null,
  notes: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  locationCount: 0,
  linkedCount: 0,
  verifiedCount: 0,
  health: "not_connected",
  connections: [],
  openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
  backfill: { running: 0, failed: 0, succeeded: 0, notStarted: 0 },
  lastSyncAt: null,
}

const fresh: ClientSetup = {
  clientId: "c1",
  hasClient: true,
  connection: null,
  accountsActive: 0,
  locationsLinked: 0,
  backfill: "not_started",
  notificationsEnabled: false,
  teamInvited: false,
  nextStep: "connect",
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function stub(
  setup: ClientSetup,
  connections: unknown[] = [],
  session: unknown = undefined
) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (session && url.includes("/api/session")) return json({ session })
      if (url.includes("/setup")) return json({ setup })
      if (url.includes("/api/google/connections")) return json({ connections })
      if (url.includes("/api/clients/c1"))
        return json({ client, locations: [] })
      return json({})
    })
  )
}

beforeEach(() => {
  search = new URLSearchParams("client=c1")
  replace.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const renderWizard = () =>
  render(
    <QueryProvider>
      <Toaster>
        <SetupWizard clientId="c1" />
      </Toaster>
    </QueryProvider>
  )

describe("SetupWizard", () => {
  it("resumes at the step the data has reached, numbered among the client’s own steps", async () => {
    stub(fresh)
    renderWizard()
    expect(
      await screen.findByRole("heading", { name: "Connect Google", level: 2 })
    ).toBeInTheDocument()
    expect(screen.getAllByText(/Step 1 of 6/).length).toBeGreaterThan(0)
    const rail = screen.getByRole("list", { name: "Setup steps" })
    // The client's own steps plus Done: agency and client are done before.
    expect(rail.querySelectorAll("li")).toHaveLength(7)
    expect(rail.querySelector("[aria-current='step']")).toHaveTextContent(
      "Connect"
    )
    // Done closes the list without a number, so the rail never counts past
    // the "of 6" in the header.
    const numbers = Array.from(rail.querySelectorAll("li")).map(
      (item) => item.textContent?.match(/\d+/)?.[0]
    )
    expect(numbers).toEqual(["1", "2", "3", "4", "5", "6", undefined])
    expect(rail.querySelector("li:last-child")).toHaveTextContent("Done")
  })

  it("docks the step's actions to the bottom edge as a surface ActionBar", async () => {
    stub(fresh)
    renderWizard()
    await screen.findByRole("heading", { name: "Connect Google", level: 2 })
    const bar = screen.getByRole("region", { name: "Step actions" })
    expect(bar).toHaveAttribute("data-slot", "setup-footer")
    expect(bar).toHaveAttribute("data-docked", "bottom")
    expect(bar).toHaveAttribute("data-bar-tone", "surface")
    expect(bar.className).toMatch(/max-md:fixed/)
    expect(
      bar.parentElement?.querySelector('[data-slot="action-bar-spacer"]')
    ).not.toBeNull()
    // Connect is not the first step, so Back is live.
    expect(within(bar).getByRole("button", { name: "Back" })).toBeEnabled()
    const next = within(bar).getByRole("button", { name: "Continue" })
    // The blocked reason stays Continue's description, in words.
    expect(next).toHaveAccessibleDescription(
      "Connect a Google account to continue."
    )
  })

  it("keeps a focused field clear of the step bar's measured top", async () => {
    stub(fresh)
    renderWizard()
    await screen.findByRole("heading", { name: "Connect Google", level: 2 })
    const section = screen
      .getByRole("heading", { name: "Connect Google", level: 2 })
      .closest("section")
    // Wired to the step's section (once it has mounted past the loading
    // states) and to the docked bar inside it, whose measured top it clears:
    // two rows when a blocked reason sits over Back and Continue.
    const wired = keepFocusClear.mock.calls.filter(
      ([ref]) => (ref as { current: Element | null }).current === section
    )
    expect(section).not.toBeNull()
    expect(wired.length).toBeGreaterThan(0)
    expect(wired.at(-1)?.[1]).toBe("[data-slot=setup-footer]")
    expect(section?.querySelector('[data-slot="setup-footer"]')).not.toBeNull()
    // The bar's own spacer reserves its measured height; no fixed-height
    // stand-in for the reason row is left behind it.
    expect(section?.querySelector(".h-6.md\\:hidden")).toBeNull()
  })

  it("says why a deep-linked step is not available yet, and rewrites the address", async () => {
    search = new URLSearchParams("client=c1&step=team")
    stub(fresh)
    renderWizard()
    expect(
      await screen.findByText(
        /“Team” opens once “Connect” is done, so setup continues here/
      )
    ).toBeInTheDocument()
    // The refused step leaves the address, so a later refetch can't jump to
    // it unasked.
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/setup?client=c1&step=connect", {
        scroll: false,
      })
    )
  })

  it("leaves the redirect note out when Google's callback came back with an error", async () => {
    search = new URLSearchParams(
      "client=c1&step=account&google=error&status=400&rid=r1"
    )
    stub(fresh)
    renderWizard()
    expect(await screen.findByTestId("setup-connect-error")).toBeVisible()
    expect(screen.queryByText(/opens once/)).toBeNull()
    // The address keeps the callback's result for the step to read.
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        "/setup?client=c1&step=connect&google=error&status=400&rid=r1",
        { scroll: false }
      )
    )
  })

  it("leaves the preamble steps unnumbered, so every step keeps its number", async () => {
    search = new URLSearchParams("client=c1&step=agency")
    stub(fresh)
    renderWizard()
    await screen.findByRole("heading", {
      name: "Confirm your agency",
      level: 2,
    })
    const rail = screen.getByRole("list", { name: "Setup steps" })
    const numbers = Array.from(rail.querySelectorAll("li")).map(
      (item) => item.textContent?.match(/\d+/)?.[0]
    )
    // Agency, Client, then Connect 1 … Team 6, then Done.
    expect(numbers).toEqual([
      undefined,
      undefined,
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      undefined,
    ])
  })

  it("keeps the operator on the step and focuses a summary when Continue is blocked", async () => {
    stub(fresh)
    renderWizard()
    await screen.findByRole("heading", { name: "Connect Google", level: 2 })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    const summary = await screen.findByRole("alert", {
      name: "Not ready to continue",
    })
    expect(summary).toHaveTextContent("Connect a Google account to continue.")
    await waitFor(() => expect(summary).toHaveFocus())
    expect(
      summary.querySelector('a[href="#setup-connect-google"]')
    ).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })

  it("leads with a connected login, then offers a new sign-in", async () => {
    stub(fresh, [
      {
        id: "g1",
        googleEmail: "ops@example.test",
        status: "active",
        notificationsEnabled: false,
        lastRefreshAt: null,
        lastErrorCode: null,
        reconnectRequired: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ])
    renderWizard()
    await screen.findByRole("heading", { name: "Connect Google", level: 2 })
    const option = await screen.findByRole("button", {
      name: "Use this account ops@example.test",
    })
    expect(option).toHaveAttribute("data-slot", "option-row")
    expect(option).toHaveAttribute("id", "setup-connect-use-first")
    const signIn = screen.getByRole("button", { name: "Sign in with Google" })
    // The reuse path comes first in the page, then the new sign-in.
    expect(
      option.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      screen.getByRole("heading", {
        name: "Or sign in with another Google account",
      })
    ).toBeInTheDocument()
    // The blocked reason names what is on screen.
    expect(
      screen.getByRole("button", { name: "Continue" })
    ).toHaveAccessibleDescription(
      "Pick an account from the list, or connect another Google account, to continue."
    )
  })

  it("scrolls to the first connected login when Continue is blocked", async () => {
    const scroll = vi.fn()
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(scroll)
    stub(fresh, [
      {
        id: "g1",
        googleEmail: "ops@example.test",
        status: "active",
        notificationsEnabled: false,
        lastRefreshAt: null,
        lastErrorCode: null,
        reconnectRequired: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ])
    renderWizard()
    await screen.findByRole("button", {
      name: "Use this account ops@example.test",
    })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    const summary = await screen.findByRole("alert", {
      name: "Not ready to continue",
    })
    expect(
      summary.querySelector('a[href="#setup-connect-use-first"]')
    ).toBeTruthy()
    await waitFor(() => expect(scroll).toHaveBeenCalled())
    expect(scroll.mock.contexts.at(-1)).toBe(
      document.getElementById("setup-connect-use-first")
    )
  })

  it("moves on once the data allows it, keeping the step in the address", async () => {
    // A login attached to this client: an agency login that is merely
    // present elsewhere does not unlock the accounts step on its own.
    stub({ ...fresh, connection: { id: "g1", status: "active" } }, [
      {
        id: "g1",
        googleEmail: "ops@example.test",
        status: "active",
        notificationsEnabled: false,
        lastRefreshAt: null,
        lastErrorCode: null,
        reconnectRequired: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ])
    renderWizard()
    await screen.findByRole("heading", { name: "Connect Google", level: 2 })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/setup?client=c1&step=account", {
        scroll: false,
      })
    )
  })

  it("lists the client's own login first as the one it keeps using", async () => {
    const login = {
      status: "active",
      notificationsEnabled: false,
      lastRefreshAt: null,
      lastErrorCode: null,
      reconnectRequired: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    }
    stub({ ...fresh, connection: { id: "g2", status: "active" } }, [
      { ...login, id: "g1", googleEmail: "other@example.test" },
      { ...login, id: "g2", googleEmail: "ops@example.test" },
    ])
    renderWizard()
    const keep = await screen.findByRole("button", {
      name: "Keep using this account ops@example.test",
    })
    expect(keep).toHaveAttribute("id", "setup-connect-use-first")
    expect(keep).toHaveTextContent("Connected to Old Crown Group")
    expect(
      screen.getByRole("button", {
        name: "Use this account other@example.test",
      })
    ).toBeInTheDocument()
  })

  it("quiets a blocked Continue on Connect so it doesn't compete with signing in", async () => {
    stub(fresh)
    renderWizard()
    await screen.findByRole("heading", { name: "Connect Google", level: 2 })
    expect(
      screen.getByRole("button", { name: "Sign in with Google" })
    ).toHaveAttribute("data-variant", "default")
    expect(screen.getByRole("button", { name: "Continue" })).toHaveAttribute(
      "data-variant",
      "secondary"
    )
  })

  it("says which Agency edit is unsaved and stays put on Continue", async () => {
    search = new URLSearchParams("client=c1&step=agency")
    stub(fresh, [], {
      userId: "u1",
      organisationId: "o1",
      organisationName: "Aman's organisation",
      workspaceMode: "agency",
      displayName: "Aman",
      email: "aman@example.test",
      role: "owner",
      canPublish: true,
    })
    renderWizard()
    await screen.findByRole("heading", {
      name: "Confirm your agency",
      level: 2,
    })
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Agency name" })
      ).not.toHaveAttribute("readonly")
    )
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Agency name" }),
      { target: { value: "Lapen Inns" } }
    )
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    const summary = await screen.findByRole("alert", {
      name: "Not ready to continue",
    })
    expect(summary).toHaveTextContent(
      "Save the new name, or change it back, before continuing."
    )
    expect(replace).not.toHaveBeenCalled()
  })

  it("re-reads setup when an optional step is skipped", async () => {
    search = new URLSearchParams("client=c1&step=team")
    const ready: ClientSetup = {
      ...fresh,
      connection: { id: "g1", status: "active" },
      accountsActive: 1,
      locationsLinked: 1,
      backfill: "running",
      nextStep: "notifications",
    }
    stub(ready)
    renderWizard()
    await screen.findByRole("heading", { name: "Invite your team", level: 2 })
    const fetches = () =>
      vi
        .mocked(fetch)
        .mock.calls.filter(([input]) => String(input).includes("/setup")).length
    const before = fetches()
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }))
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/setup?client=c1&step=done", {
        scroll: false,
      })
    )
    expect(fetches()).toBeGreaterThan(before)
  })

  it("offers no way to finish later once setup is done", async () => {
    search = new URLSearchParams("client=c1&step=done")
    stub({
      ...fresh,
      connection: { id: "g1", status: "active" },
      accountsActive: 1,
      locationsLinked: 1,
      backfill: "done",
      nextStep: "done",
    })
    renderWizard()
    await screen.findByRole("heading", {
      name: "This client is set up",
      level: 2,
    })
    expect(screen.queryByRole("link", { name: "Finish later" })).toBeNull()
    expect(screen.queryByText(/pick this up later/)).toBeNull()
  })

  it("shows the callback's real error on the connect step", async () => {
    search = new URLSearchParams(
      "client=c1&step=connect&google=error&status=400&rid=req-123"
    )
    stub(fresh)
    renderWizard()
    const alert = await screen.findByTestId("setup-connect-error")
    expect(alert).toHaveTextContent("Google didn’t connect")
    expect(alert).toHaveTextContent("req-123")
  })
})
