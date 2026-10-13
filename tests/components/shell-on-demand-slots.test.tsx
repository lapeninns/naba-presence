import { act, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({
  pathname: "/inbox",
  search: new URLSearchParams(),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.search,
}))

const connections = vi.hoisted(() => ({
  current: [] as Array<{ reconnectRequired: boolean; status: string }>,
}))
vi.mock("@/lib/queries/use-connections-query", () => ({
  useConnectionsQuery: () => ({ data: { connections: connections.current } }),
}))
const clients = vi.hoisted(() => ({
  current: [] as Array<{ id: string; freshness?: { reason: string } }>,
}))
vi.mock("@/lib/queries/use-clients", () => ({
  useClients: () => ({ data: { items: clients.current } }),
}))
const scope = vi.hoisted(() => ({ current: null as string | null }))
vi.mock("@/components/app-shell/client-context", () => ({
  useClientScope: () => scope.current,
}))

// The on-demand parts themselves, reduced to markers: these tests are about
// when the shell loads them.
vi.mock("@/components/app-shell/reconnect-banner", () => ({
  ReconnectBanner: () => <p>reconnect banner</p>,
}))
vi.mock("@/components/settings/oauth-return", () => ({
  OAuthReturn: () => <p>oauth result</p>,
}))

import { ShellReconnectBanner } from "@/components/app-shell/reconnect-banner-gate"
import { ShellOAuthReturn } from "@/components/app-shell/shell-oauth-return"

beforeEach(() => {
  nav.pathname = "/inbox"
  nav.search = new URLSearchParams()
  connections.current = []
  clients.current = []
  scope.current = null
})

describe("ShellReconnectBanner", () => {
  it("loads nothing while every login is healthy", () => {
    connections.current = [{ reconnectRequired: false, status: "active" }]
    const { container } = render(<ShellReconnectBanner />)
    expect(container.innerHTML).toBe("")
  })

  it("loads the banner for a login that needs reconnecting", async () => {
    connections.current = [{ reconnectRequired: true, status: "active" }]
    render(<ShellReconnectBanner />)
    expect(await screen.findByText("reconnect banner")).toBeTruthy()
  })

  it("ignores a disconnected login", () => {
    connections.current = [{ reconnectRequired: true, status: "disconnected" }]
    const { container } = render(<ShellReconnectBanner />)
    expect(container.innerHTML).toBe("")
  })

  it("loads the banner when the scoped client lost listing access", async () => {
    scope.current = "client-1"
    clients.current = [
      { id: "client-1", freshness: { reason: "listing_access_lost" } },
    ]
    render(<ShellReconnectBanner />)
    expect(await screen.findByText("reconnect banner")).toBeTruthy()
  })

  it("stays out of Settings › Google connections", () => {
    nav.pathname = "/settings/connections"
    connections.current = [{ reconnectRequired: true, status: "active" }]
    const { container } = render(<ShellReconnectBanner />)
    expect(container.innerHTML).toBe("")
  })
})

describe("ShellOAuthReturn", () => {
  it("loads nothing without a Google callback result", () => {
    nav.search = new URLSearchParams("queue=needs_reply")
    const { container } = render(<ShellOAuthReturn />)
    expect(container.innerHTML).toBe("")
  })

  it("loads the result panel and keeps it after the parameters go", async () => {
    nav.search = new URLSearchParams("google=connected&reconnected=1")
    const { rerender } = render(<ShellOAuthReturn />)
    expect(await screen.findByText("oauth result")).toBeTruthy()
    // The panel strips the callback parameters from the address.
    nav.search = new URLSearchParams()
    await act(async () => rerender(<ShellOAuthReturn />))
    expect(screen.getByText("oauth result")).toBeTruthy()
  })

  it("leaves pages that show their own result alone", () => {
    nav.pathname = "/settings/connections"
    nav.search = new URLSearchParams("google=error&status=denied")
    const { container } = render(<ShellOAuthReturn />)
    expect(container.innerHTML).toBe("")
  })
})
