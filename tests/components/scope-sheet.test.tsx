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

function stubClients(
  items: ClientSummary[] | undefined,
  { stale = false }: { stale?: boolean } = {}
) {
  vi.spyOn(clientsHook, "useClients").mockReturnValue({
    data: items ? { items, unassignedLocationCount: 0 } : undefined,
    isPending: items === undefined,
    // A refetch that failed after an earlier success.
    isError: stale,
  } as unknown as ReturnType<typeof clientsHook.useClients>)
}

/** A business's one home client, behind the scenes. */
const HOME = client("home", "Bell Inns", 2)
const ORGANISATION = "Bell Inns"

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

function PhoneScope({
  mode,
  organisationName = null,
  defaultOpen = false,
}: {
  mode?: WorkspaceMode
  organisationName?: string | null
  defaultOpen?: boolean
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <>
      <ClientScopeChip
        mode={mode}
        organisationName={organisationName}
        onOpen={() => setOpen(true)}
      />
      <ClientScopeSheet mode={mode} open={open} onOpenChange={setOpen} />
    </>
  )
}

function renderScope({
  mode,
  directory,
  children,
  rememberedClientId = null,
  defaultOpen = false,
}: {
  mode?: WorkspaceMode
  directory: DirectoryEntry[]
  children?: React.ReactNode
  rememberedClientId?: string | null
  /**
   * Start with the sheet open: on an org-wide page (Team, Settings,
   * Notifications) there is no chip to open it from.
   */
  defaultOpen?: boolean
}) {
  return render(
    <QueryClientProvider client={queryClientWith(directory)}>
      <ClientScopeRoot rememberedClientId={rememberedClientId}>
        <React.Suspense fallback={null}>
          <PhoneScope
            mode={mode}
            organisationName={mode === "business" ? ORGANISATION : null}
            defaultOpen={defaultOpen}
          />
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

/** The sheet as rendered already open (`defaultOpen`). */
function openedSheet() {
  return screen.findByRole("dialog", { name: "Working on" })
}

// The chip's accessible names: "Working on <title>, <listings · health>".
const ALL_CLIENTS = "Working on All clients, 3 listings · All clients in sync"
const OLD_CROWN_CHIP = "Working on Old Crown, 2 listings · In sync"
const ALL_LOCATIONS = "Working on Bell Inns, All locations · All in sync"
const THE_BELL = "Working on Bell Inns, The Bell"

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

  beforeEach(() => stubClients([HOME]))

  it("names the business and the location in scope, never a client", () => {
    location.search = "locationId=l1"
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const trigger = screen.getByRole("button", { name: THE_BELL })
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog")
    expect(trigger).toHaveAttribute("data-slot", "scope-control")
    expect(trigger).toHaveAttribute("data-variant", "chip")
    expect(trigger).toHaveAttribute("data-mode", "business")
    expect(trigger.getAttribute("aria-label")).not.toMatch(/client/i)
    // The phone chip shows the location, not only the business, so a
    // narrowed scope is seen as well as heard.
    expect(trigger).toHaveTextContent("The Bell")
    expect(trigger).not.toHaveTextContent("Bell Inns")
  })

  it("shows All locations on the chip when no location is in scope", () => {
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const trigger = screen.getByRole("button", {
      name: /^Working on Bell Inns, All locations/,
    })
    expect(trigger).toHaveTextContent("All locations")
  })

  it("carries the location's status words in its name", () => {
    location.search = "locationId=l2"
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const trigger = screen.getByRole("button", {
      name: "Working on Bell Inns, The Crown · Not linked",
    })
    expect(trigger).toHaveAttribute("data-tone", "attention")
  })

  it("carries the business's health in words with All locations, never a client", () => {
    stubClients([{ ...HOME, health: "attention" }])
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const trigger = screen.getByRole("button", {
      name: "Working on Bell Inns, All locations · Needs attention",
    })
    expect(trigger.getAttribute("aria-label")).not.toMatch(/client/i)
  })

  it("says the scope without a button with one location", () => {
    renderScope({ mode: "business", directory: [BELL] })
    expect(screen.queryByRole("button", { name: /^Working on/ })).toBeNull()
    const control = document.querySelector('[data-slot="scope-control"]')
    expect(control).toHaveAttribute("data-static", "true")
    expect(control).toHaveTextContent(ALL_LOCATIONS)
  })

  it("lists All locations and every location, with what the directory says", async () => {
    location.search = "locationId=l1"
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const sheet = await openSheet(THE_BELL)
    const group = within(sheet).getByRole("listbox", { name: "Location" })
    const options = within(group).getAllByRole("option")
    expect(options.map((option) => option.textContent)).toEqual([
      "All locations2 listings",
      "The Bell",
      "The CrownNot linked",
    ])
    expect(options[0]).toHaveAccessibleDescription("2 listings")
    expect(options[1]).toHaveAttribute("aria-selected", "true")
    expect(options[2]).toHaveAccessibleDescription("Not linked")
    expect(sheet.textContent).not.toMatch(/client|agency/i)
    expect(within(sheet).queryByRole("searchbox")).toBeNull()
  })

  it("narrows the Inbox to the chosen location and names it in a toast", async () => {
    location.search = "queue=failed&selected=r1"
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const sheet = await openSheet(ALL_LOCATIONS)
    await userEvent.click(
      within(sheet).getByRole("option", { name: "The Crown" })
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
    const sheet = await openSheet(THE_BELL)
    await userEvent.click(
      within(sheet).getByRole("option", { name: "All locations" })
    )
    expect(replace).toHaveBeenLastCalledWith("/reports?tab=google", {
      scroll: false,
    })
    expect(toastTitles()).toEqual(["Switched to All locations"])
  })

  it("does nothing, and says nothing, when the choice is already the scope", async () => {
    location.pathname = "/settings"
    renderScope({
      mode: "business",
      directory: [BELL, CROWN],
      defaultOpen: true,
    })
    const sheet = await openedSheet()
    // Settings ignores the scope, so the app bar shows no chip there.
    expect(screen.queryByRole("button", { name: /^Working on/ })).toBeNull()
    await userEvent.click(
      within(sheet).getByRole("option", { name: "All locations" })
    )
    expect(replace).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it("opens the location's listing from any other page", async () => {
    location.pathname = "/settings"
    renderScope({
      mode: "business",
      directory: [BELL, CROWN],
      defaultOpen: true,
    })
    const sheet = await openedSheet()
    await userEvent.click(
      within(sheet).getByRole("option", { name: "The Bell" })
    )
    expect(push).toHaveBeenCalledWith("/listings/l1")
    // Opening a listing is a page change, not a scope change: the chip
    // still says All locations, so no "Switched to" toast contradicts it.
    expect(toastTitles()).toEqual([])
  })

  it("asks the leave guard first, and stays quiet when it declines", async () => {
    vi.spyOn(leaveGuard, "guardNavigation").mockImplementation(() => {})
    renderScope({ mode: "business", directory: [BELL, CROWN] })
    const sheet = await openSheet(ALL_LOCATIONS)
    await userEvent.click(
      within(sheet).getByRole("option", { name: "The Bell" })
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
    const sheet = await openSheet(ALL_LOCATIONS)
    const search = within(sheet).getByRole("searchbox", {
      name: "Search locations",
    })
    expect(search).toHaveClass("text-body")
    expect(within(sheet).getAllByRole("option")).toHaveLength(10)
    await user.type(search, "venue c")
    expect(
      within(sheet)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["Venue C"])
    await user.clear(search)
    await user.type(search, "all")
    expect(
      within(sheet)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["All locations9 listings"])
    await user.clear(search)
    await user.type(search, "zzz")
    expect(within(sheet).queryAllByRole("option")).toHaveLength(0)
    expect(within(sheet).getByText("No location matches that.")).toBeVisible()
  })
})

describe("agency mode: the scope chip", () => {
  it("names the client in scope with its listings and health in words", () => {
    stubClients([{ ...OLD_CROWN, health: "attention" }, HARBOUR])
    location.search = "clientId=c1"
    renderScope({ directory: [] })
    const trigger = screen.getByRole("button", {
      name: "Working on Old Crown, 2 listings · Needs attention",
    })
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog")
    expect(trigger).toHaveAttribute("data-slot", "scope-control")
    expect(trigger).toHaveAttribute("data-variant", "chip")
    expect(trigger).toHaveAttribute("data-mode", "agency")
    expect(trigger).toHaveAttribute("data-tone", "attention")
  })

  it("sums every client's listings and rolls up their health for All clients", () => {
    stubClients([
      OLD_CROWN,
      { ...HARBOUR, health: "disconnected" },
      client("c3", "Quay Bar", 4),
    ])
    renderScope({ directory: [] })
    expect(
      screen.getByRole("button", {
        name: "Working on All clients, 7 listings · 1 client needs action",
      })
    ).toHaveAttribute("data-tone", "at-risk")
  })

  it("says the data may be stale when a refetch failed", () => {
    stubClients([OLD_CROWN, HARBOUR], { stale: true })
    location.search = "clientId=c1"
    renderScope({ directory: [] })
    expect(
      screen.getByRole("button", {
        name: "Working on Old Crown, 2 listings · Data may be stale",
      })
    ).toHaveAttribute("data-tone", "attention")
  })

  it("follows a deep link's ?clientId= over the remembered client", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1"
    renderScope({ directory: [], rememberedClientId: "c2" })
    expect(
      screen.queryByRole("button", { name: /^Working on Harbour Kitchen/ })
    ).toBeNull()
    const sheet = await openSheet(OLD_CROWN_CHIP)
    expect(
      within(sheet).getByRole("option", { name: "Old Crown" })
    ).toHaveAttribute("aria-selected", "true")
    expect(
      within(sheet).getByRole("option", { name: "Harbour Kitchen" })
    ).toHaveAttribute("aria-selected", "false")
  })

  it("says the scope without a button with one client", () => {
    stubClients([OLD_CROWN])
    renderScope({ directory: [] })
    expect(screen.queryByRole("button", { name: /^Working on/ })).toBeNull()
    const control = document.querySelector('[data-slot="scope-control"]')
    expect(control).toHaveAttribute("data-static", "true")
    expect(control).toHaveTextContent(
      "Working on All clients, 2 listings · All clients in sync"
    )
  })

  it("words each client row with its listings and health, and All clients with the sum", async () => {
    stubClients([OLD_CROWN, { ...HARBOUR, health: "attention" }])
    renderScope({ directory: [] })
    const sheet = await openSheet(
      "Working on All clients, 3 listings · 1 client needs attention"
    )
    expect(
      within(sheet).getByRole("option", { name: "All clients" })
    ).toHaveAccessibleDescription("3 listings")
    expect(
      within(sheet).getByRole("option", { name: "Old Crown" })
    ).toHaveAccessibleDescription("2 listings · In sync")
    expect(
      within(sheet).getByRole("option", { name: "Harbour Kitchen" })
    ).toHaveAccessibleDescription("1 listing · Needs attention")
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
    const sheet = await openSheet(ALL_CLIENTS)
    // The options keep their names; the chevron is its own button.
    expect(
      within(sheet).getByRole("option", { name: "Old Crown" })
    ).toBeInTheDocument()
    const chevron = within(sheet).getByRole("button", {
      name: "Locations of Old Crown",
    })
    expect(chevron).toHaveClass("size-11")
    // A listbox holds only options: the chevron sits beside the list, not
    // inside the option or the listbox.
    const list = within(sheet).getByRole("listbox", { name: "Client" })
    expect(list).not.toContainElement(chevron)
    expect(
      within(sheet).getByRole("option", { name: "Old Crown" })
    ).toHaveAttribute("aria-selected", "false")
    // A client with no locations has nothing to push to.
    expect(
      within(sheet).queryByRole("button", { name: "Locations of Empty Co" })
    ).toBeNull()
  })

  it("pushes into a client's locations and back, moving focus", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1"
    renderScope({ directory: DIRECTORY })
    const sheet = await openSheet(OLD_CROWN_CHIP)
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Locations of Old Crown" })
    )
    const title = within(sheet).getByRole("heading", { name: "Old Crown" })
    await waitFor(() => expect(title).toHaveFocus())
    expect(sheet).toHaveAccessibleName("Old Crown")
    const group = within(sheet).getByRole("listbox", { name: "Locations" })
    const options = within(group).getAllByRole("option")
    // Names, not text: the client's avatar initials are decoration.
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveAccessibleName("All Old Crown locations")
    expect(options[1]).toHaveAccessibleName("The Bell")
    expect(options[2]).toHaveAccessibleName("The Crown")
    // The client is in scope and not narrowed: its "All" row is current.
    expect(options[0]).toHaveAttribute("aria-selected", "true")

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
      within(sheet).getByRole("listbox", { name: "Client" })
    ).toBeInTheDocument()
  })

  it("goes back one level on Escape in the pushed view, and closes from the top", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1"
    renderScope({ directory: DIRECTORY })
    const sheet = await openSheet(OLD_CROWN_CHIP)
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Locations of Old Crown" })
    )
    await waitFor(() =>
      expect(
        within(sheet).getByRole("heading", { name: "Old Crown" })
      ).toHaveFocus()
    )

    await userEvent.keyboard("{Escape}")
    // Still open, back on the client list, focus on the chevron that pushed.
    expect(screen.getByRole("dialog")).toBe(sheet)
    expect(sheet).toHaveAccessibleName("Working on")
    await waitFor(() =>
      expect(
        within(sheet).getByRole("button", { name: "Locations of Old Crown" })
      ).toHaveFocus()
    )

    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("ticks the location the Inbox is narrowed to", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1&locationId=l2"
    renderScope({ directory: DIRECTORY })
    const sheet = await openSheet(OLD_CROWN_CHIP)
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Locations of Old Crown" })
    )
    expect(
      within(sheet).getByRole("option", { name: "The Crown" })
    ).toHaveAttribute("aria-selected", "true")
    expect(
      within(sheet).getByRole("option", { name: "All Old Crown locations" })
    ).toHaveAttribute("aria-selected", "false")
  })

  it("narrows Reports to a location with its client, and names both", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/reports"
    location.search = "tab=google&selected=x"
    renderScope({ directory: DIRECTORY })
    const sheet = await openSheet(ALL_CLIENTS)
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Locations of Old Crown" })
    )
    await userEvent.click(
      within(sheet).getByRole("option", { name: "The Bell" })
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
    renderScope({ directory: DIRECTORY, defaultOpen: true })
    const sheet = await openedSheet()
    // Team ignores the scope, so the app bar shows no chip there.
    expect(screen.queryByRole("button", { name: /^Working on/ })).toBeNull()
    await userEvent.click(
      within(sheet).getByRole("button", {
        name: "Locations of Harbour Kitchen",
      })
    )
    await userEvent.click(within(sheet).getByRole("option", { name: "Quay" }))
    expect(push).toHaveBeenCalledWith("/listings/l3")
    expect(toastTitles()).toEqual([])
  })

  it("widens a narrowed Inbox back to the whole client", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1&locationId=l2&selected=r1"
    renderScope({ directory: DIRECTORY })
    const sheet = await openSheet(OLD_CROWN_CHIP)
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Locations of Old Crown" })
    )
    await userEvent.click(
      within(sheet).getByRole("option", { name: "All Old Crown locations" })
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
    const sheet = await openSheet(ALL_CLIENTS)
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
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["Venue I"])
  })

  it("keeps arrow keys on the rows; Tab reaches the current row's chevron", async () => {
    const user = userEvent.setup()
    stubClients([OLD_CROWN, HARBOUR])
    renderScope({ directory: DIRECTORY })
    const sheet = await openSheet(ALL_CLIENTS)
    within(sheet).getByRole("option", { name: "All clients" }).focus()
    await user.keyboard("{ArrowDown}")
    expect(
      within(sheet).getByRole("option", { name: "Old Crown" })
    ).toHaveFocus()
    await user.tab()
    expect(
      within(sheet).getByRole("button", { name: "Locations of Old Crown" })
    ).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(
      within(sheet).getByRole("option", { name: "Harbour Kitchen" })
    ).toHaveFocus()
    expect(replace).not.toHaveBeenCalled()
  })
})

describe("the switch toast", () => {
  it("names the client after a switch", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1"
    renderScope({ directory: [] })
    const sheet = await openSheet(OLD_CROWN_CHIP)
    await userEvent.click(
      within(sheet).getByRole("option", { name: "Harbour Kitchen" })
    )
    expect(toastTitles()).toEqual(["Switched to Harbour Kitchen"])
  })

  it("says All clients", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/listings"
    location.search = "clientId=c1"
    renderScope({ directory: [] })
    const sheet = await openSheet(OLD_CROWN_CHIP)
    await userEvent.click(
      within(sheet).getByRole("option", { name: "All clients" })
    )
    expect(toastTitles()).toEqual(["Switched to All clients"])
  })

  it("widens a location-narrowed page all the way for All clients", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/reports"
    location.search = "tab=google&clientId=c1&locationId=l1"
    renderScope({ directory: [place("l1", "The Bell", "c1")] })
    const sheet = await openSheet(OLD_CROWN_CHIP)
    await userEvent.click(
      within(sheet).getByRole("option", { name: "All clients" })
    )
    expect(replace).toHaveBeenLastCalledWith("/reports?tab=google", {
      scroll: false,
    })
    expect(toastTitles()).toEqual(["Switched to All clients"])
  })

  it("stays quiet when the choice is already the client", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1"
    renderScope({ directory: [] })
    const sheet = await openSheet(OLD_CROWN_CHIP)
    await userEvent.click(
      within(sheet).getByRole("option", { name: "Old Crown" })
    )
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it("stays quiet when an editor's leave prompt declines", async () => {
    vi.spyOn(leaveGuard, "guardNavigation").mockImplementation(() => {})
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/clients/c1/settings"
    renderScope({ directory: [] })
    const sheet = await openSheet(OLD_CROWN_CHIP)
    await userEvent.click(
      within(sheet).getByRole("option", { name: "Harbour Kitchen" })
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
    const sheet = await openSheet(OLD_CROWN_CHIP)
    await userEvent.click(
      within(sheet).getByRole("option", { name: "Harbour Kitchen" })
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
    await userEvent.click(screen.getByRole("button", { name: OLD_CROWN_CHIP }))
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
