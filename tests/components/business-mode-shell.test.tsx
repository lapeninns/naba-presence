import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, renderHook, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))

import { Toaster } from "@/components/ui/toast"
import { AgencyNameForm } from "@/components/settings/agency-name-form"
import { Nav, navItemsFor, type NavClient } from "@/components/app-shell/nav"
import {
  PALETTE_ACTIONS,
  PALETTE_GO_TO,
  paletteEntriesFor,
} from "@/components/app-shell/command-palette"
import type { SessionResponse, WorkspaceMode } from "@/lib/contracts/session"
import { queryKeys } from "@/lib/queries/keys"
import { useWorkspaceMode } from "@/lib/workspace/mode"

const clients: NavClient[] = [
  { id: "c1", name: "The Barley Mow", health: "healthy" },
]

beforeEach(() => {
  window.sessionStorage.clear()
})

function wrapperWith(mode: WorkspaceMode | null, role = "owner") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  if (mode) {
    client.setQueryData(queryKeys.session, {
      session: {
        userId: "u",
        organisationId: "o",
        organisationName: "The Barley Mow",
        displayName: "Aman",
        email: "a@example.test",
        role,
        canPublish: true,
        workspaceMode: mode,
      },
    })
  }
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  }
}

describe("navigation registry per mode", () => {
  it("drops Clients for a business and keeps the rest in order", () => {
    expect(navItemsFor("business").map((item) => item.label)).toEqual([
      "Inbox",
      "Listings",
      "Reports",
    ])
    expect(navItemsFor("agency").map((item) => item.label)).toEqual([
      "Inbox",
      "Listings",
      "Clients",
      "Reports",
    ])
  })

  it("renders Inbox, Listings, Reports, Team and Settings and nothing about clients", async () => {
    const { container } = render(
      <Nav role="owner" mode="business" clients={clients} scopeClientId="c1" />
    )
    await userEvent.click(screen.getByRole("button", { name: "More" }))
    const links = screen.getAllByRole("link")
    expect(links.map((link) => link.textContent)).toEqual([
      "Inbox",
      "Listings",
      "Reports",
      "Team",
      "Settings",
    ])
    // The remembered client is never written into a business address, and
    // the pinned client list is not drawn.
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/inbox",
      "/listings",
      "/reports",
      "/team",
      "/settings",
    ])
    expect(container.textContent).not.toMatch(/client|agency/i)
  })

  it("keeps the agency navigation, with pinned clients, in agency mode", () => {
    render(<Nav mode="agency" clients={clients} scopeClientId="c1" />)
    expect(screen.getByRole("link", { name: "Clients" })).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /The Barley Mow/ })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "href",
      "/inbox?clientId=c1"
    )
  })
})

describe("command palette entries per mode", () => {
  const labels = (mode: WorkspaceMode, role: string | null = "owner") =>
    [
      ...paletteEntriesFor(PALETTE_GO_TO, role, mode),
      ...paletteEntriesFor(PALETTE_ACTIONS, role, mode),
    ].map((entry) => entry.label)

  it("removes the Clients destination and New client for a business", () => {
    const business = labels("business")
    expect(business).not.toContain("Clients")
    expect(business).not.toContain("New client")
    expect(business).toEqual(
      expect.arrayContaining([
        "Inbox",
        "Listings",
        "Reports",
        "Team",
        "Settings",
        "Connect a Google account",
        "Invite a teammate",
      ])
    )
  })

  it("keeps them in agency mode, and still applies the role filter", () => {
    expect(labels("agency")).toEqual(
      expect.arrayContaining(["Clients", "New client"])
    )
    expect(labels("agency", "member")).not.toContain("New client")
  })
})

describe("useWorkspaceMode", () => {
  it("reads the hydrated session", () => {
    const { wrapper } = wrapperWith("business")
    expect(
      renderHook(() => useWorkspaceMode(), { wrapper }).result.current
    ).toBe("business")
  })

  it("follows the session when it changes", () => {
    const { client, wrapper } = wrapperWith("agency")
    const hook = renderHook(() => useWorkspaceMode(), { wrapper })
    expect(hook.result.current).toBe("agency")
    act(() => {
      client.setQueryData<SessionResponse>(queryKeys.session, (old) =>
        old?.session
          ? { session: { ...old.session, workspaceMode: "business" } }
          : old
      )
    })
    expect(hook.result.current).toBe("business")
  })

  it("reads as agency until a session is known, and without a query client", () => {
    const { wrapper } = wrapperWith(null)
    expect(
      renderHook(() => useWorkspaceMode(), { wrapper }).result.current
    ).toBe("agency")
    expect(renderHook(() => useWorkspaceMode()).result.current).toBe("agency")
  })
})

describe("the name form", () => {
  it("is the Business name in business mode and the Agency name otherwise", () => {
    const business = wrapperWith("business")
    const { unmount } = render(
      <Toaster>
        <AgencyNameForm />
      </Toaster>,
      { wrapper: business.wrapper }
    )
    expect(
      screen.getByRole("form", { name: "Business name" })
    ).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Business name" })).toHaveValue(
      "The Barley Mow"
    )
    expect(document.body.textContent).not.toMatch(/agency|client/i)
    unmount()

    const agency = wrapperWith("agency")
    render(
      <Toaster>
        <AgencyNameForm />
      </Toaster>,
      { wrapper: agency.wrapper }
    )
    expect(
      screen.getByRole("textbox", { name: "Agency name" })
    ).toBeInTheDocument()
  })
})
