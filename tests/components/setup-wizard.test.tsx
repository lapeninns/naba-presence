import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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

function stub(setup: ClientSetup, connections: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
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
afterEach(() => vi.unstubAllGlobals())

const renderWizard = () =>
  render(
    <QueryProvider>
      <Toaster>
        <SetupWizard clientId="c1" />
      </Toaster>
    </QueryProvider>
  )

describe("SetupWizard", () => {
  it("resumes at the step the data has reached, out of nine", async () => {
    stub(fresh)
    renderWizard()
    expect(
      await screen.findByRole("heading", { name: "Connect Google", level: 2 })
    ).toBeInTheDocument()
    expect(screen.getAllByText(/Step 3 of 9/).length).toBeGreaterThan(0)
    const rail = screen.getByRole("list", { name: "Setup steps" })
    expect(rail.querySelectorAll("li")).toHaveLength(9)
    expect(rail.querySelector("[aria-current='step']")).toHaveTextContent(
      "Connect"
    )
  })

  it("says why a deep-linked step is not available yet", async () => {
    search = new URLSearchParams("client=c1&step=team")
    stub(fresh)
    renderWizard()
    expect(
      await screen.findByText(
        /hasn’t reached “Team” yet, so setup opens at “Connect”/
      )
    ).toBeInTheDocument()
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
