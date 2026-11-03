import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import * as React from "react"
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
  ClientScopeChip,
  ClientScopeSheet,
  ClientScopeSync,
  ClientSwitcher,
  ScopeControlView,
  useClientScopeLabel,
} from "@/components/app-shell/client-switcher"
import type { ClientSummary } from "@/lib/contracts/clients"
import type { DirectoryEntry } from "@/lib/locations/directory"
import { queryKeys } from "@/lib/queries/keys"
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

/**
 * The scope control's accessible name: "Working on <scope>, <listings> ·
 * <health in words>" (useScopeControl). All clients sums the listings and
 * reads the agency roll-up.
 */
const ALL_NAME = "Working on All clients, 2 listings · 1 client needs action"
const OLD_CROWN_NAME = "Working on Old Crown, 1 listing · In sync"
const HARBOUR_NAME =
  "Working on Harbour Kitchen, 1 listing · Can’t reach Google"
/** Nine healthy clients of one listing each. */
const MANY_ALL_NAME = "Working on All clients, 9 listings · All clients in sync"

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
    expect(screen.queryByRole("button", { name: /^Working on/ })).toBeNull()
    unmount()

    stubClients([])
    renderSwitcher()
    expect(screen.queryByRole("button", { name: /^Working on/ })).toBeNull()
  })

  it("is hidden while the client list is loading", () => {
    stubClients(undefined)
    renderSwitcher()
    expect(screen.queryByRole("button", { name: /^Working on/ })).toBeNull()
  })

  it("lists All clients and every visible client, with their health", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    renderSwitcher()
    const trigger = screen.getByRole("button", { name: ALL_NAME })
    await userEvent.click(trigger)
    const options = await screen.findAllByRole("menuitemradio")
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveAccessibleName("All clients")
    expect(options[0]).toHaveAttribute("aria-checked", "true")
    // The mark and the dot are decoration; the listings and health words
    // are read once, after the name.
    expect(options[1]).toHaveAccessibleName("Old Crown, 1 listing · In sync")
    expect(options[2]).toHaveAccessibleName(
      "Harbour Kitchen, 1 listing · Can’t reach Google"
    )
  })

  it("puts the tick at the end of each row, Notion Mail's switcher look", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    renderSwitcher()
    await userEvent.click(screen.getByRole("button", { name: ALL_NAME }))
    const options = await screen.findAllByRole("menuitemradio")
    for (const option of options) {
      expect(option).toHaveAttribute("data-indicator-position", "end")
      // The check column is the row's last child, after the name.
      expect(option.lastElementChild).toHaveAttribute(
        "data-slot",
        "dropdown-menu-check"
      )
    }
  })

  it("names the client in scope, with its listings and health in words", () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c2&queue=failed"
    renderSwitcher()
    const trigger = screen.getByRole("button", { name: HARBOUR_NAME })
    // The pill by default, its tone repeating the words (never alone).
    expect(trigger).toHaveAttribute("data-variant", "pill")
    expect(trigger).toHaveAttribute("data-tone", "at-risk")
    expect(trigger).toHaveTextContent("Harbour Kitchen")
    expect(trigger).toHaveTextContent("1 listing · Can’t reach Google")
  })

  it("swaps the Inbox's client in place and remembers it", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "queue=failed&clientId=c1&selected=r1"
    renderSwitcher()
    await userEvent.click(screen.getByRole("button", { name: OLD_CROWN_NAME }))
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
    await userEvent.click(screen.getByRole("button", { name: OLD_CROWN_NAME }))
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
    await userEvent.click(screen.getByRole("button", { name: OLD_CROWN_NAME }))
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
      await screen.findByRole("button", { name: OLD_CROWN_NAME })
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
    await userEvent.click(screen.getByRole("button", { name: ALL_NAME }))
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: /Old Crown/ })
    )
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(cookie()).toBe("c1")
    expect(
      screen.getByRole("button", { name: OLD_CROWN_NAME })
    ).toBeInTheDocument()
  })

  it("works from the keyboard", async () => {
    const user = userEvent.setup()
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/reports"
    location.search = "tab=google"
    renderSwitcher()
    screen.getByRole("button", { name: ALL_NAME }).focus()
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
    await userEvent.click(screen.getByRole("button", { name: OLD_CROWN_NAME }))
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
    await user.click(screen.getByRole("button", { name: MANY_ALL_NAME }))
    const search = await screen.findByRole("combobox", {
      name: "Search clients",
    })
    await waitFor(() => expect(search).toHaveFocus())
    // Field size, not the 13px control size that made iOS zoom on focus.
    expect(search).toHaveClass("text-body")
    expect(search).not.toHaveClass("text-ui")
    await user.type(search, "client e")
    const matches = screen.getAllByRole("option")
    expect(matches).toHaveLength(1)
    expect(matches[0]).toHaveAccessibleName("Client E, 1 listing · In sync")
    await user.keyboard("{Enter}")
    expect(replace).toHaveBeenLastCalledWith("/inbox?clientId=c5", {
      scroll: false,
    })
  })
})

/**
 * The phone pieces as the app bar wires them: the chip opens the sheet.
 * Inside a Suspense boundary, because the shell renders them inside one
 * (useSearchParams).
 */
function PhoneScope() {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <ClientScopeChip onOpen={() => setOpen(true)} />
      <ClientScopeSheet open={open} onOpenChange={setOpen} />
    </>
  )
}

function renderPhoneScope({
  remembered = null,
  children,
}: { remembered?: string | null; children?: React.ReactNode } = {}) {
  return render(
    <ClientScopeRoot rememberedClientId={remembered}>
      <React.Suspense fallback={null}>
        <ClientScopeSync />
        <PhoneScope />
      </React.Suspense>
      <Remembered />
      {children}
    </ClientScopeRoot>
  )
}

async function openSheet(name: string) {
  await userEvent.click(screen.getByRole("button", { name }))
  return screen.findByRole("dialog", { name: "Working on" })
}

describe("ClientScopeChip", () => {
  it("is inert when there is nothing to switch, and hidden while the list is unknown", () => {
    stubClients([OLD_CROWN])
    const { container, unmount } = renderPhoneScope()
    // One client: the chip still says what is in scope, but is no button.
    expect(screen.queryByRole("button", { name: /^Working on/ })).toBeNull()
    const inert = container.querySelector('[data-slot="scope-control"]')
    expect(inert).toHaveAttribute("data-static", "true")
    expect(inert).toHaveAttribute("data-variant", "chip")
    expect(inert).toHaveTextContent(
      "Working on All clients, 1 listing · All clients in sync"
    )
    unmount()

    stubClients(undefined)
    const { container: unknown } = renderPhoneScope()
    expect(screen.queryByRole("button", { name: /^Working on/ })).toBeNull()
    expect(unknown.querySelector('[data-slot="scope-control"]')).toBeNull()
  })

  it("names the client in scope and opens a dialog", () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c2"
    renderPhoneScope()
    const chip = screen.getByRole("button", { name: HARBOUR_NAME })
    expect(chip).toHaveAttribute("aria-haspopup", "dialog")
    expect(chip).toHaveAttribute("data-variant", "chip")
    // The chip draws the name only; the words are in its accessible name.
    expect(chip).toHaveTextContent("Harbour Kitchen")
    expect(chip).not.toHaveTextContent("Can’t reach Google")
  })

  it("is hidden on organisation-wide pages", () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/notifications"
    const { container } = renderPhoneScope()
    expect(container.querySelector('[data-slot="scope-control"]')).toBeNull()
  })

  it("says All clients when no client is in scope", () => {
    stubClients([OLD_CROWN, HARBOUR])
    renderPhoneScope()
    expect(screen.getByRole("button", { name: ALL_NAME })).toHaveTextContent(
      "All clients"
    )
  })
})

describe("ClientScopeSheet", () => {
  it("lists All clients and every client, with health in words", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c2"
    renderPhoneScope()
    const sheet = await openSheet(HARBOUR_NAME)
    const group = within(sheet).getByRole("listbox", { name: "Client" })
    const options = within(group).getAllByRole("option")
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveAccessibleName("All clients")
    expect(options[1]).toHaveAccessibleName("Old Crown")
    // Listings and health are printed as words in the row, not only
    // announced; All clients sums the listings.
    expect(within(options[0]).getByText("2 listings")).toBeVisible()
    expect(within(options[1]).getByText("1 listing · In sync")).toBeVisible()
    expect(
      within(options[2]).getByText("1 listing · Can’t reach Google")
    ).toBeVisible()
    expect(options[0]).toHaveAccessibleDescription("2 listings")
    expect(options[1]).toHaveAccessibleDescription("1 listing · In sync")
    expect(options[2]).toHaveAccessibleDescription(
      "1 listing · Can’t reach Google"
    )
    expect(options[2]).toHaveAttribute("aria-selected", "true")
    expect(options[0]).toHaveAttribute("aria-selected", "false")
    // One Tab stop for the group: the checked row.
    expect(options[2]).toHaveAttribute("tabindex", "0")
    expect(options[0]).toHaveAttribute("tabindex", "-1")
    // Two clients: no filter field.
    expect(within(sheet).queryByRole("searchbox")).toBeNull()
  })

  it("swaps the Inbox's client in place, remembers it and closes", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "queue=failed&clientId=c1&selected=r1"
    renderPhoneScope()
    const sheet = await openSheet(OLD_CROWN_NAME)
    await userEvent.click(
      within(sheet).getByRole("option", { name: "Harbour Kitchen" })
    )
    expect(replace).toHaveBeenLastCalledWith(
      "/inbox?queue=failed&clientId=c2",
      { scroll: false }
    )
    expect(cookie()).toBe("c2")
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Working on" })).toBeNull()
    )
  })

  it("goes to the same page of the other client from a client's pages", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/clients/c1/settings"
    renderPhoneScope()
    const sheet = await openSheet(OLD_CROWN_NAME)
    await userEvent.click(
      within(sheet).getByRole("option", { name: "Harbour Kitchen" })
    )
    expect(push).toHaveBeenCalledWith("/clients/c2/settings")
  })

  it("clears the scope for All clients", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.pathname = "/listings"
    location.search = "clientId=c1&order=client"
    renderPhoneScope({ remembered: "c1" })
    const sheet = await openSheet(OLD_CROWN_NAME)
    await userEvent.click(
      within(sheet).getByRole("option", { name: "All clients" })
    )
    expect(replace).toHaveBeenLastCalledWith("/listings?order=client", {
      scroll: false,
    })
    expect(cookie()).toBeNull()
  })

  it("lets a page decline the switch (an unsaved reply)", async () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1"
    const handler = vi.fn(async () => false)
    function Page() {
      useClientScopeHandler(handler)
      return null
    }
    renderPhoneScope({ remembered: "c1", children: <Page /> })
    const sheet = await openSheet(OLD_CROWN_NAME)
    await userEvent.click(
      within(sheet).getByRole("option", { name: "Harbour Kitchen" })
    )
    expect(handler).toHaveBeenCalledWith("c2")
    expect(replace).not.toHaveBeenCalled()
    expect(
      screen.getByRole("status", { name: "Remembered" })
    ).toHaveTextContent("c1")
  })

  it("moves between rows with the arrow keys without choosing", async () => {
    const user = userEvent.setup()
    stubClients([OLD_CROWN, HARBOUR])
    renderPhoneScope()
    const sheet = await openSheet(ALL_NAME)
    const all = within(sheet).getByRole("option", { name: "All clients" })
    all.focus()
    await user.keyboard("{ArrowDown}")
    expect(
      within(sheet).getByRole("option", { name: "Old Crown" })
    ).toHaveFocus()
    expect(replace).not.toHaveBeenCalled()
    await user.keyboard("{ArrowDown}{Enter}")
    expect(replace).toHaveBeenLastCalledWith("/inbox?clientId=c2", {
      scroll: false,
    })
  })

  it("filters with a plain 16px search field past eight clients", async () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      client(`c${index + 1}`, `Client ${String.fromCharCode(65 + index)}`)
    )
    stubClients(many)
    const user = userEvent.setup()
    renderPhoneScope()
    const sheet = await openSheet(MANY_ALL_NAME)
    const search = within(sheet).getByRole("searchbox", {
      name: "Search clients",
    })
    // A native field, not a cmdk combobox, at field size (`text-body`) so
    // iOS does not zoom on focus.
    expect(search.tagName).toBe("INPUT")
    expect(search).toHaveClass("text-body")
    expect(within(sheet).getAllByRole("option")).toHaveLength(10)

    await user.type(search, "client e")
    const matches = within(sheet).getAllByRole("option")
    expect(matches).toHaveLength(1)
    expect(matches[0]).toHaveAccessibleName("Client E")
    await user.click(matches[0])
    expect(replace).toHaveBeenLastCalledWith("/inbox?clientId=c5", {
      scroll: false,
    })
  })

  it("says so when nothing matches the filter", async () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      client(`c${index + 1}`, `Client ${String.fromCharCode(65 + index)}`)
    )
    stubClients(many)
    const user = userEvent.setup()
    renderPhoneScope()
    const sheet = await openSheet(MANY_ALL_NAME)
    await user.type(
      within(sheet).getByRole("searchbox", { name: "Search clients" }),
      "zzz"
    )
    expect(within(sheet).queryAllByRole("option")).toHaveLength(0)
    expect(within(sheet).getByText("No client matches that.")).toBeVisible()
  })
})

describe("useClientScopeLabel", () => {
  function Label() {
    const { visible, label, healthWords, client } = useClientScopeLabel()
    return (
      <output aria-label="Scope">
        {JSON.stringify({ visible, label, healthWords, id: client?.id })}
      </output>
    )
  }

  function renderLabel() {
    return render(
      <ClientScopeRoot rememberedClientId={null}>
        <Label />
      </ClientScopeRoot>
    )
  }

  it("names the scoped client and its health in words", () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c2"
    renderLabel()
    expect(
      JSON.parse(screen.getByRole("status", { name: "Scope" }).textContent!)
    ).toEqual({
      visible: true,
      label: "Harbour Kitchen",
      healthWords: "Can’t reach Google",
      id: "c2",
    })
  })

  it("says All clients, and is not visible with one client", () => {
    stubClients([OLD_CROWN])
    renderLabel()
    expect(
      JSON.parse(screen.getByRole("status", { name: "Scope" }).textContent!)
    ).toEqual({ visible: false, label: "All clients", healthWords: null })
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
    expect(screen.getByRole("button", { name: ALL_NAME })).toBeInTheDocument()
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
    expect(screen.getByRole("button", { name: ALL_NAME })).toBeInTheDocument()
    await waitFor(() => expect(cookie()).toBeNull())
    expect(replace).not.toHaveBeenCalled()
  })
})

describe("ScopeControlView", () => {
  function renderControl({
    variant,
    mode = "agency",
    organisationName = null,
    directory,
  }: {
    variant: "sidebar" | "pill" | "chip"
    mode?: "agency" | "business"
    organisationName?: string | null
    directory?: DirectoryEntry[]
  }) {
    const queryClient = new QueryClient()
    if (directory) queryClient.setQueryData(queryKeys.locations, directory)
    return render(
      <QueryClientProvider client={queryClient}>
        <ClientScopeRoot rememberedClientId={null}>
          <ScopeControlView
            variant={variant}
            mode={mode}
            organisationName={organisationName}
          />
        </ClientScopeRoot>
      </QueryClientProvider>
    )
  }

  it("names the sidebar's scope with its listings and health in words, under a Working on caption", () => {
    stubClients([OLD_CROWN, HARBOUR])
    location.search = "clientId=c1"
    const { container } = renderControl({ variant: "sidebar" })
    const wrapper = container.querySelector('[data-slot="sidebar-scope"]')
    expect(wrapper).not.toBeNull()
    expect(within(wrapper as HTMLElement).getByText("Working on")).toBeVisible()
    const control = screen.getByRole("button", { name: OLD_CROWN_NAME })
    expect(control).toHaveAttribute("data-variant", "sidebar")
    expect(control).toHaveAttribute("data-mode", "agency")
    expect(control).toHaveAttribute("data-tone", "healthy")
    expect(control).toHaveTextContent("1 listing · In sync")
  })

  it("is drawn but not a button when there is only one client", () => {
    stubClients([OLD_CROWN])
    const { container } = renderControl({ variant: "sidebar" })
    expect(screen.queryByRole("button")).toBeNull()
    const control = container.querySelector('[data-slot="scope-control"]')
    expect(control).toHaveAttribute("data-static", "true")
    expect(control?.tagName).not.toBe("BUTTON")
    expect(control).toHaveTextContent(
      "Working on All clients, 1 listing · All clients in sync"
    )
    // Inert: nothing suggests it can be pressed.
    expect(control).toHaveClass("hover-fine:hover:border-transparent")
  })

  it.each(["/team", "/settings", "/settings/billing"])(
    "is not drawn on %s, which ignores the scope",
    (pathname) => {
      stubClients([OLD_CROWN, HARBOUR])
      location.pathname = pathname
      const { container } = renderControl({ variant: "pill" })
      expect(container.querySelector('[data-slot="scope-control"]')).toBeNull()
      expect(container).toBeEmptyDOMElement()
    }
  )

  it("shows a business its own name with All locations, never a client", () => {
    stubClients([OLD_CROWN])
    renderControl({
      variant: "pill",
      mode: "business",
      organisationName: "The Crown Group",
      directory: [
        { id: "l1", name: "The Bell", linked: true },
        { id: "l2", name: "The Swan", linked: true },
      ],
    })
    const control = screen.getByRole("button", {
      name: "Working on The Crown Group, All locations · All in sync",
    })
    expect(control).toHaveAttribute("data-variant", "pill")
    expect(control).toHaveAttribute("data-mode", "business")
    expect(control).toHaveAttribute("aria-haspopup", "dialog")
    expect(control).toHaveTextContent("The Crown Group")
    expect(control).toHaveTextContent("All locations")
    expect(control).not.toHaveTextContent(/client/i)
  })
})

describe("the scope control's slot", () => {
  // Pages, the e2e suites and the shell's CSS find the control by
  // `data-slot="scope-control"` at every size, switchable or not.
  it("stays scope-control when the control opens the desk menu", () => {
    stubClients([OLD_CROWN, HARBOUR])
    render(
      <ClientScopeRoot rememberedClientId={null}>
        <ScopeControlView
          variant="sidebar"
          mode="agency"
          organisationName={null}
        />
      </ClientScopeRoot>
    )
    expect(screen.getByRole("button", { name: ALL_NAME })).toHaveAttribute(
      "data-slot",
      "scope-control"
    )
  })
})
