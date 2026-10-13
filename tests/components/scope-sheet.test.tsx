import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest"

const push = vi.fn()
const replace = vi.fn()
const location = vi.hoisted(() => ({ pathname: "/inbox", search: "" }))
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(location.search),
}))

import {
  ClientScopeRoot,
  useClientScopeHandler,
} from "@/components/app-shell/client-context"
import {
  ClientScopeChip,
  ClientScopeSheet,
  ClientSwitcher,
  useScopeLabel,
} from "@/components/app-shell/client-switcher"
import * as toastModule from "@/components/ui/toast"
import type { ClientSummary } from "@/lib/contracts/clients"
import * as leaveGuard from "@/lib/editors/use-leave-guard"
import type { DirectoryEntry } from "@/lib/locations/directory"
import { queryKeys } from "@/lib/queries/keys"
import * as clientsHook from "@/lib/queries/use-clients"
import type { WorkspaceMode } from "@/lib/workspace/terms"

function client(id: string, name: string, locationCount = 1): ClientSummary {
  return {
    id,
    name,
    slug: id,
    colour: null,
    logoUrl: null,
    notes: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    locationCount,
    linkedCount: 1,
    verifiedCount: 1,
    health: "healthy",
    connections: [],
    openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
    backfill: { running: 0, failed: 0, succeeded: 1, notStarted: 0 },
    lastSyncAt: null,
  } as ClientSummary
}

function place(
  id: string,
  name: string,
  clientId: string | null = null,
  extra: Partial<DirectoryEntry> = {}
): DirectoryEntry {
  return {
    id,
    name,
    linked: true,
    verified: true,
    clientId,
    clientName: null,
    ...extra,
  }
}

const OLD_CROWN = client("c1", "Old Crown", 2)
const HARBOUR = client("c2", "Harbour Kitchen", 1)

function stubClients(items: ClientSummary[] | undefined) {
  vi.spyOn(clientsHook, "useClients").mockReturnValue({
    data: items ? { items, unassignedLocationCount: 0 } : undefined,
    isPending: items === undefined,
  } as unknown as ReturnType<typeof clientsHook.useClients>)
}

/** A query client already holding the session and the directory, as the
 *  dashboard layout hydrates them; never fetches. */
function queryClientWith(directory: DirectoryEntry[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  queryClient.setQueryData(queryKeys.session, {
    session: { role: "owner", workspaceMode: "agency" },
  })
  queryClient.setQueryData(queryKeys.locationsManagement, directory)
  return queryClient
}

function PhoneScope({ mode }: { mode?: WorkspaceMode }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <ClientScopeChip mode={mode} onOpen={() => setOpen(true)} />
      <ClientScopeSheet mode={mode} open={open} onOpenChange={setOpen} />
    </>
  )
}

function renderScope({
  mode,
  directory,
  children,
}: {
  mode?: WorkspaceMode
  directory: DirectoryEntry[]
  children?: React.ReactNode
}) {
  return render(
    <QueryClientProvider client={queryClientWith(directory)}>
      <ClientScopeRoot rememberedClientId={null}>
        <React.Suspense fallback={null}>
          <PhoneScope mode={mode} />
        </React.Suspense>
        {children}
      </ClientScopeRoot>
    </QueryClientProvider>
  )
}

async function openSheet(name: string) {
  await userEvent.click(screen.getByRole("button", { name }))
  return screen.findByRole("dialog", { name: "Working on" })
}

let toastAdd: MockInstance<typeof toastModule.toast.add>

beforeEach(() => {
  location.pathname = "/inbox"
  location.search = ""
  document.cookie = "np_client=; Path=/; Max-Age=0"
  toastAdd = vi.spyOn(toastModule.toast, "add").mockReturnValue("t1")
})

afterEach(() => {
  vi.restoreAllMocks()
  push.mockReset()
  replace.mockReset()
})

function toastTitles() {
  return toastAdd.mock.calls.map(
    (call) => (call[0] as { title?: string }).title
  )
}

describe("business mode", () => {
  const BELL = place("l1", "The Bell")
  const CROWN = place("l2", "The Crown", null, { linked: false })

  it("names the location in scope, never a client", () => {
    location.search = "locationId=l1"
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const trigger = screen.getByRole("button", { name: "Location: The Bell" })
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog")
    expect(trigger).toHaveAttribute("data-slot", "client-scope-chip")
    expect(screen.queryByRole("button", { name: /^Client:/ })).toBeNull()
  })

  it("is hidden with one location", () => {
    renderScope({ mode: "business", directory: [BELL] })
    expect(screen.queryByRole("button", { name: /^Location:/ })).toBeNull()
  })

  it("lists All locations and every location, with what the directory says", async () => {
    location.search = "locationId=l1"
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const sheet = await openSheet("Location: The Bell")
    const group = within(sheet).getByRole("radiogroup", { name: "Location" })
    const radios = within(group).getAllByRole("radio")
    expect(radios.map((radio) => radio.textContent)).toEqual([
      "All locations",
      "The Bell",
      "The CrownNot linked",
    ])
    expect(radios[1]).toHaveAttribute("aria-checked", "true")
    expect(radios[2]).toHaveAccessibleDescription("Not linked")
    expect(sheet.textContent).not.toMatch(/client|agency/i)
    expect(within(sheet).queryByRole("searchbox")).toBeNull()
  })

  it("narrows the Inbox to the chosen location and names it in a toast", async () => {
    location.search = "queue=failed&selected=r1"
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const sheet = await openSheet("Location: All locations")
    await userEvent.click(
      within(sheet).getByRole("radio", { name: "The Crown" })
    )
    expect(replace).toHaveBeenLastCalledWith(
      "/inbox?queue=failed&locationId=l2",
      { scroll: false }
    )
    expect(toastTitles()).toEqual(["Switched to The Crown"])
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Working on" })).toBeNull()
    )
  })

  it("widens back to All locations on Reports", async () => {
    location.pathname = "/reports"
    location.search = "tab=google&locationId=l1"
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const sheet = await openSheet("Location: The Bell")
    await userEvent.click(
      within(sheet).getByRole("radio", { name: "All locations" })
    )
    expect(replace).toHaveBeenLastCalledWith("/reports?tab=google", {
      scroll: false,
    })
    expect(toastTitles()).toEqual(["Switched to All locations"])
  })

  it("does nothing, and says nothing, when the choice is already the scope", async () => {
    location.pathname = "/settings"
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const sheet = await openSheet("Location: All locations")
    await userEvent.click(
      within(sheet).getByRole("radio", { name: "All locations" })
    )
    expect(replace).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it("opens the location's listing from any other page", async () => {
    location.pathname = "/settings"
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const sheet = await openSheet("Location: All locations")
    await userEvent.click(
      within(sheet).getByRole("radio", { name: "The Bell" })
    )
    expect(push).toHaveBeenCalledWith("/listings/l1")
    expect(toastTitles()).toEqual(["Switched to The Bell"])
  })

  it("asks the leave guard first, and stays quiet when it declines", async () => {
    vi.spyOn(leaveGuard, "guardNavigation").mockImplementation(() => {})
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const sheet = await openSheet("Location: All locations")
    await userEvent.click(
      within(sheet).getByRole("radio", { name: "The Bell" })
    )
    expect(leaveGuard.guardNavigation).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it("filters past eight locations, and says when nothing matches", async () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      place(`l${index + 1}`, `Venue ${String.fromCharCode(65 + index)}`)
    )
    const user = userEvent.setup()
    renderScope({ mode: "business", directory: many })
    const sheet = await openSheet("Location: All locations")
    const search = within(sheet).getByRole("searchbox", {
      name: "Search locations",
    })
    expect(search).toHaveClass("text-body")
    expect(within(sheet).getAllByRole("radio")).toHaveLength(10)
    await user.type(search, "venue c")
    expect(
      within(sheet)
        .getAllByRole("radio")
        .map((radio) => radio.textContent)
    ).toEqual(["Venue C"])
    await user.clear(search)
    await user.type(search, "zzz")
    expect(within(sheet).queryAllByRole("radio")).toHaveLength(0)
    expect(within(sheet).getByText("No location matches that.")).toBeVisible()
  })
})

describe("agency mode: a client's locations", () => {
  const BELL = place("l1", "The Bell", "c1")
  const CROWN = place("l2", "The Crown", "c1")
  const QUAY = place("l3", "Quay", "c2")
  const DIRECTORY = [BELL, CROWN, QUAY]

  it("offers each client's locations as a separate 44px control", async () => {
    stubClients([OLD_CROWN, HARBOUR, client("c3", "Empty Co", 0)])
    renderScope({ directory: DIRECTORY })
    const sheet = await openSheet("Client: All clients")
    // The radios keep their names; the chevron is its own button.
    expect(
      within(sheet).getByRole("radio", { name: "Old Crown" })
    ).toBeInTheDocument()
    const chevron = within(sheet).getByRole("button", {
      name: "Locations of Old Crown",
    })
    expect(chevron).toHaveClass("size-11")
    // A client with no locations has nothing to push to.
    expect(
      within(sheet).queryByRole("button", { name: "Locations of Empty Co" })
    ).toBeNull()
  })

  it("pushes into a client's locations and back, moving focus", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1"
    renderScope({ directory: DIRECTORY })
    const sheet = await openSheet("Client: Old Crown")
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Locations of Old Crown" })
    )
    const title = within(sheet).getByRole("heading", { name: "Old Crown" })
    await waitFor(() => expect(title).toHaveFocus())
    expect(sheet).toHaveAccessibleName("Old Crown")
    const group = within(sheet).getByRole("radiogroup", { name: "Locations" })
    const radios = within(group).getAllByRole("radio")
    // Names, not text: the client's avatar initials are decoration.
    expect(radios).toHaveLength(3)
    expect(radios[0]).toHaveAccessibleName("All Old Crown locations")
    expect(radios[1]).toHaveAccessibleName("The Bell")
    expect(radios[2]).toHaveAccessibleName("The Crown")
    // The client is in scope and not narrowed: its "All" row is current.
    expect(radios[0]).toHaveAttribute("aria-checked", "true")

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Back to All clients" })
    )
    expect(sheet).toHaveAccessibleName("Working on")
    await waitFor(() =>
      expect(
        within(sheet).getByRole("button", { name: "Locations of Old Crown" })
      ).toHaveFocus()
    )
    expect(
      within(sheet).getByRole("radiogroup", { name: "Client" })
    ).toBeInTheDocument()
  })

  it("ticks the location the Inbox is narrowed to", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1&locationId=l2"
    renderScope({ directory: DIRECTORY })
    const sheet = await openSheet("Client: Old Crown")
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Locations of Old Crown" })
    )
    expect(
      within(sheet).getByRole("radio", { name: "The Crown" })
    ).toHaveAttribute("aria-checked", "true")
    expect(
      within(sheet).getByRole("radio", { name: "All Old Crown locations" })
    ).toHaveAttribute("aria-checked", "false")
  })

  it("narrows Reports to a location with its client, and names both", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/reports"
    location.search = "tab=google&selected=x"
    renderScope({ directory: DIRECTORY })
    const sheet = await openSheet("Client: All clients")
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Locations of Old Crown" })
    )
    await userEvent.click(
      within(sheet).getByRole("radio", { name: "The Bell" })
    )
    expect(replace).toHaveBeenLastCalledWith(
      "/reports?tab=google&locationId=l1&clientId=c1",
      { scroll: false }
    )
    expect(toastTitles()).toEqual(["Switched to The Bell · Old Crown"])
  })

  it("opens the listing from a page with no location scope", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/team"
    renderScope({ directory: DIRECTORY })
    const sheet = await openSheet("Client: All clients")
    await userEvent.click(
      within(sheet).getByRole("button", {
        name: "Locations of Harbour Kitchen",
      })
    )
    await userEvent.click(within(sheet).getByRole("radio", { name: "Quay" }))
    expect(push).toHaveBeenCalledWith("/listings/l3")
  })

  it("widens a narrowed Inbox back to the whole client", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1&locationId=l2&selected=r1"
    renderScope({ directory: DIRECTORY })
    const sheet = await openSheet("Client: Old Crown")
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Locations of Old Crown" })
    )
    await userEvent.click(
      within(sheet).getByRole("radio", { name: "All Old Crown locations" })
    )
    expect(replace).toHaveBeenLastCalledWith("/inbox?clientId=c1", {
      scroll: false,
    })
    expect(toastTitles()).toEqual(["Switched to Old Crown"])
  })

  it("searches a client's locations past eight", async () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      place(`l${index + 1}`, `Venue ${String.fromCharCode(65 + index)}`, "c1")
    )
    stubClients([OLD_CROWN, HARBOUR])
    const user = userEvent.setup()
    renderScope({ directory: many })
    const sheet = await openSheet("Client: All clients")
    // Two clients: no search on the first view.
    expect(within(sheet).queryByRole("searchbox")).toBeNull()
    await user.click(
      within(sheet).getByRole("button", { name: "Locations of Old Crown" })
    )
    const search = within(sheet).getByRole("searchbox", {
      name: "Search locations",
    })
    await user.type(search, "venue i")
    expect(
      within(sheet)
        .getAllByRole("radio")
        .map((radio) => radio.textContent)
    ).toEqual(["Venue I"])
  })

  it("keeps arrow keys on the rows; Tab reaches the current row's chevron", async () => {
    const user = userEvent.setup()
    stubClients([OLD_CROWN, HARBOUR])
    renderScope({ directory: DIRECTORY })
    const sheet = await openSheet("Client: All clients")
    within(sheet).getByRole("radio", { name: "All clients" }).focus()
    await user.keyboard("{ArrowDown}")
    expect(
      within(sheet).getByRole("radio", { name: "Old Crown" })
    ).toHaveFocus()
    await user.tab()
    expect(
      within(sheet).getByRole("button", { name: "Locations of Old Crown" })
    ).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(
      within(sheet).getByRole("radio", { name: "Harbour Kitchen" })
    ).toHaveFocus()
    expect(replace).not.toHaveBeenCalled()
  })
})

describe("the switch toast", () => {
  it("names the client after a switch", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1"
    renderScope({ directory: [] })
    const sheet = await openSheet("Client: Old Crown")
    await userEvent.click(
      within(sheet).getByRole("radio", { name: "Harbour Kitchen" })
    )
    expect(toastTitles()).toEqual(["Switched to Harbour Kitchen"])
  })

  it("says All clients", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/listings"
    location.search = "clientId=c1"
    renderScope({ directory: [] })
    const sheet = await openSheet("Client: Old Crown")
    await userEvent.click(
      within(sheet).getByRole("radio", { name: "All clients" })
    )
    expect(toastTitles()).toEqual(["Switched to All clients"])
  })

  it("stays quiet when the choice is already the client", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1"
    renderScope({ directory: [] })
    const sheet = await openSheet("Client: Old Crown")
    await userEvent.click(
      within(sheet).getByRole("radio", { name: "Old Crown" })
    )
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it("stays quiet when an editor's leave prompt declines", async () => {
    vi.spyOn(leaveGuard, "guardNavigation").mockImplementation(() => {})
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/clients/c1/settings"
    renderScope({ directory: [] })
    const sheet = await openSheet("Client: Old Crown")
    await userEvent.click(
      within(sheet).getByRole("radio", { name: "Harbour Kitchen" })
    )
    expect(push).not.toHaveBeenCalled()
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it("stays quiet when the Inbox declines (an unsaved reply)", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1"
    const handler = vi.fn(async () => false)
    function Page() {
      useClientScopeHandler(handler)
      return null
    }
    renderScope({ directory: [], children: <Page /> })
    const sheet = await openSheet("Client: Old Crown")
    await userEvent.click(
      within(sheet).getByRole("radio", { name: "Harbour Kitchen" })
    )
    await waitFor(() => expect(handler).toHaveBeenCalledWith("c2"))
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it("follows a switch from the desk switcher too", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1"
    render(
      <ClientScopeRoot rememberedClientId={null}>
        <ClientSwitcher />
      </ClientScopeRoot>
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Client: Old Crown" })
    )
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: /Harbour Kitchen/ })
    )
    expect(toastTitles()).toEqual(["Switched to Harbour Kitchen"])
  })
})

describe("useScopeLabel", () => {
  function Label({ mode }: { mode: WorkspaceMode }) {
    const { visible, label, location: where } = useScopeLabel(mode)
    return (
      <output aria-label="Scope">
        {JSON.stringify({ visible, label, location: where?.id ?? null })}
      </output>
    )
  }

  it("reads the location in scope in business mode without the client list", () => {
    const useClients = vi.spyOn(clientsHook, "useClients")
    location.search = "locationId=l2"
    render(
      <QueryClientProvider
        client={queryClientWith([
          place("l1", "The Bell"),
          place("l2", "The Crown"),
        ])}
      >
        <ClientScopeRoot rememberedClientId={null}>
          <Label mode="business" />
        </ClientScopeRoot>
      </QueryClientProvider>
    )
    expect(
      JSON.parse(screen.getByRole("status", { name: "Scope" }).textContent!)
    ).toEqual({ visible: true, label: "The Crown", location: "l2" })
    // A business never asks for clients.
    expect(useClients).toHaveBeenCalledWith({ enabled: false })
  })

  it("treats a list of locations as a filter, not a scope", () => {
    location.search = "locationId=l1,l2"
    render(
      <QueryClientProvider
        client={queryClientWith([
          place("l1", "The Bell"),
          place("l2", "The Crown"),
        ])}
      >
        <ClientScopeRoot rememberedClientId={null}>
          <Label mode="business" />
        </ClientScopeRoot>
      </QueryClientProvider>
    )
    expect(
      JSON.parse(screen.getByRole("status", { name: "Scope" }).textContent!)
    ).toEqual({ visible: true, label: "All locations", location: null })
  })
})
