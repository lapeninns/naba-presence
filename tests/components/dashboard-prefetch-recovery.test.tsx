import { useQueryClient, QueryClient } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode, ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const stubs = vi.hoisted(() => ({ session: vi.fn(), clients: vi.fn(), connections: vi.fn(), directory: vi.fn(), counts: vi.fn(), shell: vi.fn() }))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }))
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: ComponentProps<"a">) => <a href={href} {...rest}>{children}</a> }))
vi.mock("@/components/app-shell/app-shell", () => ({ AppShell: ({ children, ...props }: { children: ReactNode }) => { stubs.shell(props); return <section aria-label="Dashboard shell">{children}</section> } }))
vi.mock("@/lib/server/session", () => ({ getSession: stubs.session, isLocalBootstrapEnabled: () => false }))
vi.mock("@/lib/server/clients", () => ({ listClientSummaries: stubs.clients }))
vi.mock("@/lib/server/connections", () => ({ listConnections: stubs.connections }))
vi.mock("@/lib/server/location-directory", () => ({ listLocationDirectoryRows: stubs.directory }))
vi.mock("@/lib/server/review-counts", () => ({ readReviewCounts: stubs.counts }))
vi.mock("@/lib/server/db", () => ({ withTenant: async (_id: string, callback: (sql: object) => unknown) => callback({}) }))
vi.mock("@/lib/queries/query-client", () => ({ makeQueryClient: () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } }) }))

import DashboardLayout from "@/app/(dashboard)/layout"
import { ListingGate } from "@/components/listings/listing-gate"
import { FileUnderClient } from "@/components/listings/file-under-client"
import { Toaster } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"

const location = { locationId: "l1", name: "Synthetic listing", address: null, timezone: "Europe/London", linkId: null, externalLocationId: null, googleLocationName: null, googleTitle: null, verified: null, clientId: null, clientName: null }
const counts = { total: 4, byStatus: { new: 3, published: 1 }, byQueue: { needs_reply: 3, approval: 0, awaiting_my_approval: 0, awaiting_others: 0, publishing: 0, failed: 0, done: 1, all: 4 } }
function CountsProbe() {
  const query = useQueryClient()
  return <output aria-label="Counts cache">{JSON.stringify(query.getQueryData(queryKeys.reviewCounts("organisation")) ?? null)}</output>
}
function HydratedProbe() {
  const query = useQueryClient()
  return <output aria-label="Session cache">{JSON.stringify(query.getQueryData(queryKeys.session))}</output>
}
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }) }
beforeEach(() => {
  stubs.session.mockResolvedValue({ sessionId: "s1", userId: "u1", organisationId: "o1", organisationName: "Test", workspaceMode: "agency", displayName: "Owner", email: "test@invalid.test", role: "owner", canPublish: true })
  stubs.clients.mockResolvedValue({ items: [], unassignedLocationCount: 1 })
  stubs.connections.mockResolvedValue([])
  stubs.directory.mockResolvedValue([location])
  stubs.counts.mockResolvedValue(counts)
})
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals() })

describe("dashboard optional prefetch recovery", () => {
  it("lets a failed directory prefetch reach the listing error and retry while retaining the authenticated shell", async () => {
    stubs.directory.mockRejectedValue(new Error("synthetic directory failure"))
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ error: "http_error" }, 503)).mockResolvedValue(json({ locations: [location] }))
    vi.stubGlobal("fetch", fetcher)
    render(await DashboardLayout({ children: <><HydratedProbe /><ListingGate locationId="l1" role="owner">{(entry) => <h1>{entry.name}</h1>}</ListingGate></> }))
    expect(screen.getByRole("region", { name: "Dashboard shell" })).toBeInTheDocument()
    expect(screen.getByLabelText("Session cache")).toHaveTextContent('"role":"owner"')
    expect(screen.getByLabelText("Session cache")).not.toHaveTextContent("sessionId")
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }))
    expect(await screen.findByRole("heading", { name: "Synthetic listing" })).toBeInTheDocument()
  })

  it("keeps a hydrated listing when clients prefetch fails and filing recovers independently", async () => {
    stubs.clients.mockRejectedValue(new Error("synthetic clients failure"))
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ error: "http_error" }, 503)).mockResolvedValue(json({ items: [], unassignedLocationCount: 1 }))
    vi.stubGlobal("fetch", fetcher)
    render(await DashboardLayout({ children: <Toaster><ListingGate locationId="l1" role="owner">{(entry) => <><h1>{entry.name}</h1><FileUnderClient locationId={entry.id} locationName={entry.name} /></>}</ListingGate></Toaster> }))
    expect(screen.getByRole("heading", { name: "Synthetic listing" })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole("button", { name: "Retry clients" }))
    expect(await screen.findByRole("link", { name: "Create client" })).toHaveAttribute("href", "/clients/new?listing=l1")
    expect(fetcher.mock.calls.every(([url]) => String(url) === "/api/clients")).toBe(true)
  })

  it("hydrates the shell's organisation-wide review counts under the badge's key", async () => {
    render(await DashboardLayout({ children: <CountsProbe /> }))
    expect(JSON.parse(screen.getByLabelText("Counts cache").textContent ?? "null")).toEqual(counts)
    // Organisation-wide in every mode: no client or location scope reaches the read.
    expect(stubs.counts).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organisationId: "o1" }), {})
  })

  it("leaves the counts cache empty when the counts read fails", async () => {
    stubs.counts.mockRejectedValue(new Error("synthetic counts failure"))
    render(await DashboardLayout({ children: <CountsProbe /> }))
    expect(screen.getByLabelText("Counts cache")).toHaveTextContent("null")
    expect(screen.getByRole("region", { name: "Dashboard shell" })).toBeInTheDocument()
  })

  it("hands the client shell only the session's display fields", async () => {
    stubs.session.mockResolvedValue({ sessionId: "s1", userId: "u1", organisationId: "o1", organisationName: "Test", workspaceMode: "agency", displayName: "Owner", email: "test@invalid.test", role: "owner", canPublish: true, supportActor: null, impersonationReason: null, scopeFingerprint: "fp", access: "full", entitlementEnforced: true })
    render(await DashboardLayout({ children: <p>Content</p> }))
    const [props] = stubs.shell.mock.calls.at(-1) as [{ session: Record<string, unknown> }]
    // The shell is a client component: its props are serialised into the RSC payload.
    expect(props.session).toEqual({ organisationId: "o1", organisationName: "Test", workspaceMode: "agency", displayName: "Owner", email: "test@invalid.test", role: "owner", supportActor: null })
    expect(JSON.stringify(props)).not.toContain("s1")
  })

  it("does not swallow authentication lookup failures", async () => {
    stubs.session.mockRejectedValue(new Error("synthetic session failure"))
    await expect(DashboardLayout({ children: <p>Content</p> })).rejects.toThrow("synthetic session failure")
    expect(stubs.directory).not.toHaveBeenCalled()
  })
})
