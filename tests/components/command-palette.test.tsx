import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
const replace = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => "/listings",
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(),
}))

import { ClientScopeRoot } from "@/components/app-shell/client-context"
import {
  CommandPalette,
  CommandPaletteButton,
  useCommandPalette,
} from "@/components/app-shell/command-palette"
import type { ClientSummary } from "@/lib/contracts/clients"
import { queryKeys } from "@/lib/queries/keys"
import * as clientsHook from "@/lib/queries/use-clients"
import * as locationsHook from "@/lib/queries/use-locations"
import * as sessionHook from "@/lib/queries/use-session"
import type { WorkspaceMode } from "@/lib/workspace/terms"

// The dialog is a dynamic import on first open; under a loaded machine the
// chunk can take longer than findBy's 1s default to arrive.
const LAZY = { timeout: 5000 }

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

function stub({ role }: { role: string | null }) {
  vi.spyOn(clientsHook, "useClients").mockReturnValue({
    data: {
      items: [client("c1", "Old Crown"), client("c2", "Harbour Kitchen")],
      unassignedLocationCount: 0,
    },
    isPending: false,
  } as unknown as ReturnType<typeof clientsHook.useClients>)
  vi.spyOn(locationsHook, "useLocationDirectory").mockReturnValue({
    data: [],
  } as unknown as ReturnType<typeof locationsHook.useLocationDirectory>)
  vi.spyOn(sessionHook, "useSessionRole").mockReturnValue(role)
}

/** The toolbar's wiring: the button, the shortcut hook and the palette. */
function Toolbar({ hideCalendar }: { hideCalendar?: boolean }) {
  const { open, setOpen } = useCommandPalette()
  return (
    <>
      <CommandPaletteButton onClick={() => setOpen(true)} />
      <input aria-label="Reply" />
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        hideCalendar={hideCalendar}
      />
    </>
  )
}

function renderPalette({
  role = "owner",
  mode = "agency",
  remembered = null,
  hideCalendar,
}: {
  role?: string | null
  mode?: WorkspaceMode
  remembered?: string | null
  hideCalendar?: boolean
} = {}) {
  stub({ role })
  // useWorkspaceMode reads the hydrated session from the query cache.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(queryKeys.session, {
    session: { role, workspaceMode: mode },
  })
  const wrap = (children: React.ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <ClientScopeRoot rememberedClientId={remembered}>
        {children}
      </ClientScopeRoot>
    </QueryClientProvider>
  )
  return render(wrap(<Toolbar hideCalendar={hideCalendar} />))
}

async function openPalette() {
  await userEvent.click(
    screen.getByRole("button", { name: /^Search (clients, )?listings/ })
  )
  return screen.findByRole("dialog", { name: "Commands" }, LAZY)
}

async function goToLabels() {
  const dialog = await openPalette()
  const group = within(dialog).getByRole("group", { name: "Go to" })
  return within(group)
    .getAllByRole("option")
    .map((option) => option.textContent)
}

beforeEach(() => {
  document.cookie = "np_client=; Path=/; Max-Age=0"
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  push.mockReset()
  replace.mockReset()
})

describe("CommandPalette loading", () => {
  it("renders nothing until it is first opened, then loads the dialog", async () => {
    renderPalette()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("combobox")).toBeNull()
    const dialog = await openPalette()
    expect(within(dialog).getByRole("combobox")).toBeInTheDocument()
  })

  it("toggles on Cmd/Ctrl+K and opens on / outside a field", async () => {
    const user = userEvent.setup()
    renderPalette()
    await user.keyboard("{Control>}k{/Control}")
    await screen.findByRole("dialog", { name: "Commands" }, LAZY)
    await user.keyboard("{Control>}k{/Control}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    // A slash typed into a reply stays in the reply.
    await user.click(screen.getByRole("textbox", { name: "Reply" }))
    await user.keyboard("/")
    expect(screen.getByRole("textbox", { name: "Reply" })).toHaveValue("/")
    expect(screen.queryByRole("dialog")).toBeNull()

    screen.getByRole("textbox", { name: "Reply" }).blur()
    await user.keyboard("/")
    await screen.findByRole("dialog", { name: "Commands" }, LAZY)
  })

  it("opens on the np:open-command-palette event", async () => {
    renderPalette()
    document.dispatchEvent(new Event("np:open-command-palette"))
    expect(
      await screen.findByRole("dialog", { name: "Commands" }, LAZY)
    ).toBeInTheDocument()
  })
})

describe("CommandPalette Go to", () => {
  it("lists the registry's destinations for an agency owner", async () => {
    renderPalette()
    expect(await goToLabels()).toEqual([
      "Inbox",
      "Listings",
      "Clients",
      "Calendar",
      "Reports",
      "Notifications",
      "Team",
      "Settings",
    ])
  })

  it("leaves Team out for a member and Clients out for a business", async () => {
    renderPalette({ role: "member", mode: "business" })
    expect(await goToLabels()).toEqual([
      "Inbox",
      "Listings",
      "Calendar",
      "Reports",
      "Notifications",
      "Settings",
    ])
  })

  it("leaves Calendar out when scheduling is off", async () => {
    renderPalette({ hideCalendar: true })
    expect(await goToLabels()).not.toContain("Calendar")
  })

  it("keeps the remembered client on scoped destinations", async () => {
    renderPalette({ remembered: "c1" })
    const dialog = await openPalette()
    await userEvent.click(
      within(dialog).getByRole("option", { name: "Reports" })
    )
    expect(push).toHaveBeenCalledWith("/reports?clientId=c1")
  })
})

describe("CommandPalette review search", () => {
  it("offers nothing to search until something is typed", async () => {
    renderPalette()
    const dialog = await openPalette()
    expect(
      within(dialog).queryByRole("option", { name: /^Search reviews for/ })
    ).toBeNull()
  })

  it("hands the words to the Inbox's search, last and in scope", async () => {
    const user = userEvent.setup()
    renderPalette({ remembered: "c1" })
    const dialog = await openPalette()
    // Words that also match a client: the client stays first (Enter jumps
    // to it) and the review search waits at the end of the list.
    await user.type(within(dialog).getByRole("combobox"), "harbour")
    const options = within(dialog).getAllByRole("option")
    expect(options.length).toBeGreaterThan(1)
    expect(options[0]).toHaveTextContent("Harbour Kitchen")
    expect(options.at(-1)).toHaveTextContent("Search reviews for “harbour”")
    await user.click(options.at(-1)!)
    expect(push).toHaveBeenCalledWith("/inbox?clientId=c1&search=harbour")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("makes the review search the one choice when nothing else matches", async () => {
    const user = userEvent.setup()
    renderPalette({ remembered: "c1" })
    const dialog = await openPalette()
    await user.type(within(dialog).getByRole("combobox"), "cold soup")
    await user.keyboard("{Enter}")
    expect(push).toHaveBeenCalledWith("/inbox?clientId=c1&search=cold%20soup")
  })

  it("never carries a client in business mode", async () => {
    const user = userEvent.setup()
    renderPalette({ mode: "business", remembered: "c1" })
    const dialog = await openPalette()
    await user.type(within(dialog).getByRole("combobox"), "rude & slow")
    await user.click(
      within(dialog).getByRole("option", {
        name: "Search reviews for “rude & slow”",
      })
    )
    expect(push).toHaveBeenCalledWith("/inbox?search=rude%20%26%20slow")
  })

  it("keeps the field at field size on a phone", async () => {
    renderPalette()
    const dialog = await openPalette()
    const input = within(dialog).getByRole("combobox")
    // The primitive's 16px floor on a touch screen; nothing here sizes the
    // field down to `text-ui`.
    expect(input).toHaveClass("pointer-coarse:text-base!")
    expect(input).not.toHaveClass("text-ui")
  })

  it("draws the primitive's phone takeover, with D8 group labels", async () => {
    renderPalette()
    const dialog = await openPalette()
    expect(dialog).toHaveAttribute("data-phone", "takeover")
    expect(
      dialog.querySelector('[data-slot="command-takeover-bar"]')
    ).not.toBeNull()
    // The palette's own field row and heading override are gone.
    expect(dialog.querySelector('[data-slot="command-palette-bar"]')).toBeNull()
    expect(dialog.querySelector(".font-sans")).toBeNull()
  })

  it("says nothing matched and still offers the review search", async () => {
    const user = userEvent.setup()
    renderPalette()
    const dialog = await openPalette()
    await user.type(within(dialog).getByRole("combobox"), "cold soup")
    expect(
      within(dialog).getByText(/^Nothing matched “cold soup”\./)
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole("option", {
        name: "Search reviews for “cold soup”",
      })
    ).toBeInTheDocument()
  })
})

/** Pretends the viewport is a phone (below `sm`) or a desk. */
function stubViewport(desk: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: desk,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }))
  )
}

describe("CommandPalette phone takeover", () => {
  it("never opens a hidden row on Enter before anything is typed on a phone", async () => {
    stubViewport(false)
    const user = userEvent.setup()
    renderPalette()
    const dialog = await openPalette()
    // cmdk has highlighted a row and the field has focus: Enter would act.
    await waitFor(() =>
      expect(
        within(dialog).getAllByRole("option", { selected: true })
      ).toHaveLength(1)
    )
    await user.click(within(dialog).getByRole("combobox"))
    await user.keyboard("{Enter}")
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog", { name: "Commands" })).toBeInTheDocument()
  })

  it("keeps Enter on the highlighted row at the desk", async () => {
    stubViewport(true)
    const user = userEvent.setup()
    renderPalette()
    const dialog = await openPalette()
    // cmdk has highlighted a row and the field has focus: Enter would act.
    await waitFor(() =>
      expect(
        within(dialog).getAllByRole("option", { selected: true })
      ).toHaveLength(1)
    )
    await user.click(within(dialog).getByRole("combobox"))
    await user.keyboard("{Enter}")
    expect(push).toHaveBeenCalledWith("/clients/c1")
  })

  it("draws the trigger as a bare icon on a phone, keeping its name", () => {
    renderPalette()
    const button = screen.getByRole("button", {
      name: "Search clients, listings, pages and actions",
    })
    expect(button).toHaveClass(
      "max-md:size-11",
      "max-md:border-transparent",
      "max-md:bg-transparent",
      "focus-halo"
    )
  })

  it("closes on Cancel and gives focus back to the button", async () => {
    const user = userEvent.setup()
    renderPalette()
    const dialog = await openPalette()
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(push).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^Search (clients, )?listings/ })
      ).toHaveFocus()
    )
  })

  it("clears the field from the clear button, only while there is text", async () => {
    const user = userEvent.setup()
    renderPalette()
    const dialog = await openPalette()
    const input = within(dialog).getByRole("combobox")
    expect(
      within(dialog).queryByRole("button", { name: "Clear search" })
    ).toBeNull()
    await user.type(input, "harbour")
    await user.click(
      within(dialog).getByRole("button", { name: "Clear search" })
    )
    expect(input).toHaveValue("")
    expect(input).toHaveFocus()
    expect(
      within(dialog).queryByRole("button", { name: "Clear search" })
    ).toBeNull()
    expect(screen.getByRole("dialog", { name: "Commands" })).toBeInTheDocument()
  })

  it("shows a quiet hint before anything is typed, without client words in business mode", async () => {
    const user = userEvent.setup()
    renderPalette({ mode: "business" })
    const dialog = await openPalette()
    const hint = within(dialog).getByText("Search listings and pages")
    expect(hint).toBeInTheDocument()
    expect(dialog).not.toHaveTextContent(/client/i)
    await user.type(within(dialog).getByRole("combobox"), "inbox")
    expect(within(dialog).queryByText("Search listings and pages")).toBeNull()
  })

  it("names clients in the hint for an agency", async () => {
    renderPalette()
    const dialog = await openPalette()
    expect(
      within(dialog).getByText("Search clients, listings and pages")
    ).toBeInTheDocument()
  })
})
