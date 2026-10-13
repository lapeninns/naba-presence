import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const pathname = vi.hoisted(() => ({ current: "/listings" }))
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import { AppBar } from "@/components/app-shell/app-bar"
import { ClientScopeRoot } from "@/components/app-shell/client-context"
import {
  PageChrome,
  PageChromeProvider,
} from "@/components/app-shell/page-chrome"
import type { ClientSummary } from "@/lib/contracts/clients"
import { queryKeys } from "@/lib/queries/keys"
import * as clientsHook from "@/lib/queries/use-clients"
import * as locationsHook from "@/lib/queries/use-locations"
import type { WorkspaceMode } from "@/lib/workspace/terms"

// The phone app bar's leading control: a labelled back control on a deep
// page (derived from the trail, or a page's <PageChrome back> override),
// otherwise the client chip (agency, more than one client) or the
// workspace's name.

function client(id: string, name: string): ClientSummary {
  return {
    id,
    name,
    slug: id,
    colour: null,
    logoUrl: null,
    notes: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    locationCount: 1,
    linkedCount: 1,
    verifiedCount: 1,
    health: "healthy",
    connections: [],
    openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
    backfill: { running: 0, failed: 0, succeeded: 1, notStarted: 0 },
    lastSyncAt: null,
  } as ClientSummary
}

let clientList: ClientSummary[] = []

beforeEach(() => {
  clientList = [client("c1", "Old Crown Group")]
  vi.spyOn(clientsHook, "useClients").mockImplementation(
    () =>
      ({
        data: { items: clientList, unassignedLocationCount: 0 },
        isPending: false,
      }) as unknown as ReturnType<typeof clientsHook.useClients>
  )
  vi.spyOn(locationsHook, "useLocationDirectory").mockReturnValue({
    data: [
      {
        id: "l1",
        name: "Old Crown Girton",
        clientId: "c1",
        clientName: "Old Crown Group",
      },
    ],
  } as unknown as ReturnType<typeof locationsHook.useLocationDirectory>)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 }))
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  pathname.current = "/listings"
})

function renderBar({
  mode = "agency",
  page,
  onOpenClientScope = vi.fn(),
}: {
  mode?: WorkspaceMode
  page?: React.ReactNode
  onOpenClientScope?: () => void
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(queryKeys.session, {
    session: { role: "owner", workspaceMode: mode },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ClientScopeRoot rememberedClientId={null}>
        <PageChromeProvider>
          <AppBar
            mode={mode}
            organisationName="Lapen Inns Agency"
            sessionReady
            onOpenPalette={vi.fn()}
            onOpenClientScope={onOpenClientScope}
          />
          <main id="main">
            <h1>Page</h1>
            {page}
          </main>
        </PageChromeProvider>
      </ClientScopeRoot>
    </QueryClientProvider>
  )
  const bar = document.querySelector<HTMLElement>('[data-slot="app-bar"]')!
  return { bar, within: within(bar) }
}

describe("AppBar leading control", () => {
  it("shows a labelled back control on a deep page", async () => {
    pathname.current = "/listings/l1"
    const { within: bar } = renderBar()
    const back = await bar.findByRole("link", { name: "Back to Listings" })
    expect(back).toHaveAttribute("href", "/listings")
    // The visible label is the destination; "Back to" is for the name.
    expect(back).toHaveTextContent("Listings")
    expect(bar.queryByText("Lapen Inns Agency")).not.toBeInTheDocument()
  })

  it("names a listing area's parent listing", async () => {
    pathname.current = "/listings/l1/hours"
    const { within: bar } = renderBar()
    expect(
      await bar.findByRole("link", { name: "Back to Old Crown Girton" })
    ).toHaveAttribute("href", "/listings/l1")
  })

  it("names the workspace on a top-level page with nothing to switch", () => {
    const { within: bar } = renderBar()
    expect(bar.getByText("Lapen Inns Agency")).toBeInTheDocument()
    expect(bar.queryByRole("link", { name: /^Back to/ })).toBeNull()
    expect(bar.queryByRole("button", { name: /^Client:/ })).toBeNull()
  })

  it("puts the client chip there for an agency with more than one client", async () => {
    clientList = [client("c1", "Old Crown Group"), client("c2", "Harbour")]
    const onOpenClientScope = vi.fn()
    const { within: bar } = renderBar({ onOpenClientScope })
    const chip = bar.getByRole("button", { name: "Client: All clients" })
    expect(chip).toHaveAttribute("aria-haspopup", "dialog")
    await userEvent.click(chip)
    expect(onOpenClientScope).toHaveBeenCalledTimes(1)
    expect(bar.queryByText("Lapen Inns Agency")).not.toBeInTheDocument()
  })

  it("never shows the client chip to a business", () => {
    clientList = [client("c1", "Old Crown Group"), client("c2", "Harbour")]
    const { within: bar } = renderBar({ mode: "business" })
    expect(bar.queryByRole("button", { name: /^Client:/ })).toBeNull()
    expect(bar.getByText("Lapen Inns Agency")).toBeInTheDocument()
  })

  it("leaves the palette button out on the Inbox, which has its own search", () => {
    pathname.current = "/inbox"
    const { within: bar } = renderBar()
    expect(bar.queryByRole("button", { name: /^Search/ })).toBeNull()
    expect(bar.getByRole("link", { name: "Notifications" })).toBeInTheDocument()
  })

  it("offers the palette button elsewhere", () => {
    const { within: bar } = renderBar()
    expect(
      bar.getByRole("button", {
        name: "Search clients, listings, pages and actions",
      })
    ).toBeInTheDocument()
  })

  it("keeps the compact title out of the accessibility tree", () => {
    const { bar } = renderBar()
    const title = bar.querySelector('[data-slot="app-bar-title"]')!
    expect(title).toHaveAttribute("aria-hidden", "true")
    // The h1 is still on screen, so the bar repeats nothing yet.
    expect(title).toHaveAttribute("data-visible", "false")
  })
})

describe("PageChrome overrides", () => {
  it("replaces the derived back target", async () => {
    pathname.current = "/listings/l1/hours"
    const { within: bar } = renderBar({
      page: (
        <PageChrome
          back={{ href: "/inbox?queue=needs_reply", label: "Reviews" }}
        />
      ),
    })
    expect(
      await bar.findByRole("link", { name: "Back to Reviews" })
    ).toHaveAttribute("href", "/inbox?queue=needs_reply")
    expect(
      bar.queryByRole("link", { name: "Back to Old Crown Girton" })
    ).toBeNull()
  })

  it("adds a back control to a top-level path", async () => {
    pathname.current = "/inbox"
    const { within: bar } = renderBar({
      page: <PageChrome back={{ href: "/inbox", label: "Reviews" }} />,
    })
    expect(
      await bar.findByRole("link", { name: "Back to Reviews" })
    ).toBeInTheDocument()
  })

  it("runs the page's own back on a plain activation, and stays a link", async () => {
    // The Inbox's pushed review: "‹ Inbox" pops the entry it pushed and
    // refocuses the row, rather than pushing the list on top.
    pathname.current = "/inbox"
    const onBack = vi.fn()
    const { within: bar } = renderBar({
      page: (
        <PageChrome
          back={{ href: "/inbox?queue=all", label: "Inbox" }}
          onBack={onBack}
        />
      ),
    })
    const link = await bar.findByRole("link", { name: "Back to Inbox" })
    expect(link).toHaveAttribute("href", "/inbox?queue=all")
    await userEvent.click(link)
    expect(onBack).toHaveBeenCalledOnce()
    link.focus()
    await userEvent.keyboard("{Enter}")
    expect(onBack).toHaveBeenCalledTimes(2)
  })

  it("leaves a modified click to the browser", async () => {
    // Cmd/Ctrl-click opens the list in a new tab; the page stays put.
    pathname.current = "/inbox"
    const onBack = vi.fn()
    const { within: bar } = renderBar({
      page: (
        <PageChrome
          back={{ href: "/inbox?queue=all", label: "Inbox" }}
          onBack={onBack}
        />
      ),
    })
    const link = await bar.findByRole("link", { name: "Back to Inbox" })
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    })
    link.dispatchEvent(click)
    expect(onBack).not.toHaveBeenCalled()
  })

  it("calls the latest handler without re-registering the override", async () => {
    pathname.current = "/inbox"
    const first = vi.fn()
    const second = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    queryClient.setQueryData(queryKeys.session, {
      session: { role: "owner", workspaceMode: "agency" },
    })
    const ui = (onBack: () => void) => (
      <QueryClientProvider client={queryClient}>
        <ClientScopeRoot rememberedClientId={null}>
          <PageChromeProvider>
            <AppBar
              mode="agency"
              organisationName="Lapen Inns Agency"
              sessionReady
              onOpenPalette={vi.fn()}
              onOpenClientScope={vi.fn()}
            />
            <PageChrome
              back={{ href: "/inbox?queue=all", label: "Inbox" }}
              onBack={onBack}
            />
          </PageChromeProvider>
        </ClientScopeRoot>
      </QueryClientProvider>
    )
    const { rerender } = render(ui(first))
    rerender(ui(second))
    await userEvent.click(
      await screen.findByRole("link", { name: "Back to Inbox" })
    )
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it("removes the back control with back={null}", async () => {
    pathname.current = "/listings/l1"
    const { within: bar } = renderBar({ page: <PageChrome back={null} /> })
    expect(await bar.findByText("Lapen Inns Agency")).toBeInTheDocument()
    expect(bar.queryByRole("link", { name: /^Back to/ })).toBeNull()
  })

  it("lets the page shorten the compact title", async () => {
    const { bar } = renderBar({ page: <PageChrome title="Short" /> })
    const title = bar.querySelector('[data-slot="app-bar-title"]')!
    await screen.findByText("Short", {
      selector: '[data-slot="app-bar-title"]',
    })
    expect(title).toHaveTextContent("Short")
  })

  it("lifts its override when the page unmounts", async () => {
    pathname.current = "/listings/l1"
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    queryClient.setQueryData(queryKeys.session, {
      session: { role: "owner", workspaceMode: "agency" },
    })
    const ui = (withOverride: boolean) => (
      <QueryClientProvider client={queryClient}>
        <ClientScopeRoot rememberedClientId={null}>
          <PageChromeProvider>
            <AppBar
              mode="agency"
              organisationName="Lapen Inns Agency"
              sessionReady
              onOpenPalette={vi.fn()}
              onOpenClientScope={vi.fn()}
            />
            {withOverride ? (
              <PageChrome back={{ href: "/inbox", label: "Reviews" }} />
            ) : null}
          </PageChromeProvider>
        </ClientScopeRoot>
      </QueryClientProvider>
    )
    const { rerender } = render(ui(true))
    expect(
      await screen.findByRole("link", { name: "Back to Reviews" })
    ).toBeInTheDocument()
    rerender(ui(false))
    expect(
      await screen.findByRole("link", { name: "Back to Listings" })
    ).toBeInTheDocument()
  })
})
