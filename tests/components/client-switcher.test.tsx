import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
const replace = vi.fn()
const location = vi.hoisted(() => ({ pathname: "/inbox", search: "" }))
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(location.search),
}))

import {
  ClientScopeProvider,
  ClientScopeRoot,
  useClientScopeHandler,
  useRememberedClient,
} from "@/components/app-shell/client-context"
import {
  ClientScopeSync,
  ClientSwitcher,
} from "@/components/app-shell/client-switcher"
import type { ClientSummary } from "@/lib/contracts/clients"
import * as clientsHook from "@/lib/queries/use-clients"

function client(
  id: string,
  name: string,
  health: ClientSummary["health"] = "healthy"
): ClientSummary {
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
    health,
    connections: [],
    openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
    backfill: { running: 0, failed: 0, succeeded: 1, notStarted: 0 },
    lastSyncAt: null,
  } as ClientSummary
}

const OLD_CROWN = client("c1", "Old Crown")
const HARBOUR = client("c2", "Harbour Kitchen", "disconnected")

function stubClients(items: ClientSummary[] | undefined) {
  vi.spyOn(clientsHook, "useClients").mockReturnValue({
    data: items ? { items, unassignedLocationCount: 0 } : undefined,
    isPending: items === undefined,
  } as unknown as ReturnType<typeof clientsHook.useClients>)
}

/** The remembered client, as the sidebar would read it. */
function Remembered() {
  const { remembered } = useRememberedClient()
  return <output aria-label="Remembered">{remembered ?? "none"}</output>
}

function renderSwitcher({
  remembered = null,
  children,
}: { remembered?: string | null; children?: React.ReactNode } = {}) {
  return render(
    <ClientScopeRoot rememberedClientId={remembered}>
      <ClientScopeSync />
      <ClientSwitcher />
      <Remembered />
      {children}
    </ClientScopeRoot>
  )
}

function cookie() {
  return /(?:^|; )np_client=([^;]*)/.exec(document.cookie)?.[1] ?? null
}

beforeEach(() => {
  location.pathname = "/inbox"
  location.search = ""
  document.cookie = "np_client=; Path=/; Max-Age=0"
})

afterEach(() => {
  vi.restoreAllMocks()
  push.mockReset()
  replace.mockReset()
})

describe("ClientSwitcher", () => {
  it("is hidden when the session sees one client or none", () => {
    stubClients([OLD_CROWN])
    const { unmount } = renderSwitcher()
    expect(screen.queryByRole("button", { name: /^Client:/ })).toBeNull()
    unmount()

    stubClients([])
    renderSwitcher()
    expect(screen.queryByRole("button", { name: /^Client:/ })).toBeNull()
  })

  it("is hidden while the client list is loading", () => {
    stubClients(undefined)
    renderSwitcher()
    expect(screen.queryByRole("button", { name: /^Client:/ })).toBeNull()
  })

  it("lists All clients and every visible client, with their health", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    renderSwitcher()
    const trigger = screen.getByRole("button", { name: "Client: All clients" })
    await userEvent.click(trigger)
    const options = await screen.findAllByRole("menuitemradio")
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveAccessibleName("All clients")
    expect(options[0]).toHaveAttribute("aria-checked", "true")
    // The mark is decoration; the health word is read after the name.
    expect(options[1]).toHaveAccessibleName("Old Crown, Up to date")
    expect(options[2]).toHaveAccessibleName("Harbour Kitchen, Action needed")
  })

  it("names the client in scope, with its health as the description", () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c2&queue=failed"
    renderSwitcher()
    const trigger = screen.getByRole("button", {
      name: "Client: Harbour Kitchen",
    })
    expect(trigger).toHaveAccessibleDescription("Action needed")
  })

  it("swaps the Inbox's client in place and remembers it", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "queue=failed&clientId=c1&selected=r1"
    renderSwitcher()
    await userEvent.click(
      screen.getByRole("button", { name: "Client: Old Crown" })
    )
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: /Harbour Kitchen/ })
    )
    expect(replace).toHaveBeenLastCalledWith(
      "/inbox?queue=failed&clientId=c2",
      { scroll: false }
    )
    expect(cookie()).toBe("c2")
    expect(
      screen.getByRole("status", { name: "Remembered" })
    ).toHaveTextContent("c2")
  })

  it("clears the scope everywhere for All clients", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/listings"
    location.search = "clientId=c1&order=client"
    renderSwitcher({ remembered: "c1" })
    await userEvent.click(
      screen.getByRole("button", { name: "Client: Old Crown" })
    )
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "All clients" })
    )
    expect(replace).toHaveBeenLastCalledWith("/listings?order=client", {
      scroll: false,
    })
    expect(cookie()).toBeNull()
  })

  it("goes to the same page of the other client from a client's pages", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/clients/c1/settings"
    renderSwitcher()
    await userEvent.click(
      screen.getByRole("button", { name: "Client: Old Crown" })
    )
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: /Harbour Kitchen/ })
    )
    expect(push).toHaveBeenCalledWith("/clients/c2/settings")
  })

  it("goes from a listing to the other client's hub", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/listings/l1/hours"
    renderSwitcher({
      children: (
        <ClientScopeProvider clientId="c1">
          <span />
        </ClientScopeProvider>
      ),
    })
    await userEvent.click(
      await screen.findByRole("button", { name: "Client: Old Crown" })
    )
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: /Harbour Kitchen/ })
    )
    expect(push).toHaveBeenCalledWith("/clients/c2")
  })

  it("only changes the remembered client on a page with no client of its own", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/team"
    renderSwitcher()
    await userEvent.click(
      screen.getByRole("button", { name: "Client: All clients" })
    )
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: /Old Crown/ })
    )
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(cookie()).toBe("c1")
    expect(
      screen.getByRole("button", { name: "Client: Old Crown" })
    ).toBeInTheDocument()
  })

  it("works from the keyboard", async () => {
    const user = userEvent.setup()
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/reports"
    location.search = "tab=google"
    renderSwitcher()
    screen.getByRole("button", { name: "Client: All clients" }).focus()
    await user.keyboard("{Enter}")
    await screen.findAllByRole("menuitemradio")
    await waitFor(() =>
      expect(
        screen.getByRole("menuitemradio", { name: "All clients" })
      ).toHaveFocus()
    )
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}")
    expect(replace).toHaveBeenLastCalledWith(
      "/reports?tab=google&clientId=c2",
      { scroll: false }
    )
  })

  it("lets a page decline the switch (an unsaved reply) and keeps the preference", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1"
    const handler = vi.fn(async () => false)
    function Page() {
      useClientScopeHandler(handler)
      return null
    }
    renderSwitcher({ remembered: "c1", children: <Page /> })
    await userEvent.click(
      screen.getByRole("button", { name: "Client: Old Crown" })
    )
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: /Harbour Kitchen/ })
    )
    expect(handler).toHaveBeenCalledWith("c2")
    expect(replace).not.toHaveBeenCalled()
    expect(
      screen.getByRole("status", { name: "Remembered" })
    ).toHaveTextContent("c1")
  })

  it("searches when there are more than eight clients", async () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      client(`c${index + 1}`, `Client ${String.fromCharCode(65 + index)}`)
    )
    stubClients(many)
    const user = userEvent.setup()
    renderSwitcher()
    await user.click(
      screen.getByRole("button", { name: "Client: All clients" })
    )
    const search = await screen.findByRole("combobox", {
      name: "Search clients",
    })
    await waitFor(() => expect(search).toHaveFocus())
    await user.type(search, "client e")
    const matches = screen.getAllByRole("option")
    expect(matches).toHaveLength(1)
    expect(matches[0]).toHaveAccessibleName("Client E, Up to date")
    await user.keyboard("{Enter}")
    expect(replace).toHaveBeenLastCalledWith("/inbox?clientId=c5", {
      scroll: false,
    })
  })
})

describe("ClientScopeSync", () => {
  it("fills the remembered client into a scoped page arrived at unscoped", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "queue=failed"
    renderSwitcher({ remembered: "c2" })
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/inbox?queue=failed&clientId=c2", {
        scroll: false,
      })
    )
  })

  it("remembers the client an address arrives with", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/reports"
    location.search = "clientId=c1"
    renderSwitcher()
    await waitFor(() => expect(cookie()).toBe("c1"))
    expect(replace).not.toHaveBeenCalled()
  })

  it("falls back to All clients when the client is no longer visible", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/inbox"
    location.search = "clientId=gone&queue=failed"
    document.cookie = "np_client=gone; Path=/"
    renderSwitcher({ remembered: "gone" })
    expect(
      screen.getByRole("button", { name: "Client: All clients" })
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/inbox?queue=failed", {
        scroll: false,
      })
    )
    expect(cookie()).toBeNull()
  })

  it("forgets a remembered client that vanished, on any page", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/settings"
    document.cookie = "np_client=gone; Path=/"
    renderSwitcher({ remembered: "gone" })
    expect(
      screen.getByRole("button", { name: "Client: All clients" })
    ).toBeInTheDocument()
    await waitFor(() => expect(cookie()).toBeNull())
    expect(replace).not.toHaveBeenCalled()
  })
})
