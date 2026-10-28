import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MenuTab } from "@/components/locations/menu-tab"
import { Toaster } from "@/components/ui/toast"
import * as menuApi from "@/lib/api/location-menu"
import type { FoodMenusState } from "@/lib/api/location-menu"

const useMenuMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-menu", () => ({
  useFoodMenus: () => useMenuMock(),
}))
vi.mock("@/lib/queries/use-location-capabilities", () => ({
  useLocationCapabilities: () => useCapsMock(),
}))

function makeMenus(overrides: Partial<FoodMenusState> = {}): FoodMenusState {
  return {
    location: {
      id: "loc-1",
      name: "Riverside",
      googleLocationName: "locations/1",
    },
    canonicalResource: { revision: "4", updatedAt: "2026-08-01T00:00:00.000Z" },
    eligible: true,
    status: "drift",
    canonicalMenus: [
      {
        labels: [{ displayName: "Mains" }],
        sections: [
          {
            labels: [{ displayName: "Starters" }],
            items: [
              {
                labels: [{ displayName: "Soup" }],
                attributes: {
                  price: { currencyCode: "GBP", units: "6", nanos: 500000000 },
                },
              },
            ],
          },
        ],
      },
    ],
    googleMenus: [],
    canonicalHash: "ch",
    googleHash: "gh",
    canonicalCounts: { menus: 1, sections: 1, items: 1, options: 0 },
    googleCounts: { menus: 0, sections: 0, items: 0, options: 0 },
    canPublish: true,
    writesEnabled: true,
    ...overrides,
  }
}

/** The default menu with extra empty sections, enough to earn the find tools. */
function makeLongMenus(): FoodMenusState {
  const base = makeMenus()
  const menu = base.canonicalMenus[0] as { sections: unknown[] }
  return {
    ...base,
    canonicalMenus: [
      {
        ...menu,
        sections: [
          ...menu.sections,
          { labels: [{ displayName: "Mains" }], items: [] },
          { labels: [{ displayName: "Desserts" }], items: [] },
        ],
      },
    ],
  }
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const tree = () => (
    <QueryClientProvider client={client}>
      <Toaster>
        <MenuTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
  const view = render(tree())
  return { ...view, rerenderTab: () => view.rerender(tree()) }
}

/** Opens an item's sheet from its row; its fields are edited there. */
async function openItem(
  user: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await user.click(screen.getByRole("button", { name: `Edit ${name}` }))
  return screen.findByRole("dialog")
}

async function closeItem(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Done" })
  )
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  )
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("MenuTab", () => {
  it("renders the section and item with its price for an owner", () => {
    useMenuMock.mockReturnValue({
      data: makeMenus(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(screen.getByDisplayValue("Starters")).toBeInTheDocument()
    const soup = screen.getByRole("button", { name: "Edit Soup" })
    expect(soup).toHaveTextContent("Soup")
    expect(soup).toHaveTextContent("£6.50")
    expect(
      screen.getByRole("button", { name: "Review changes" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
  })

  it("saves the menu here without publishing, and asks before discarding", async () => {
    const user = userEvent.setup()
    const saveSpy = vi
      .spyOn(menuApi, "saveFoodMenus")
      .mockResolvedValue(
        {} as Awaited<ReturnType<typeof menuApi.saveFoodMenus>>
      )
    const publishSpy = vi.spyOn(menuApi, "publishFoodMenus")
    useMenuMock.mockReturnValue({
      data: makeMenus(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()

    await openItem(user, "Soup")
    const item = screen.getByDisplayValue("Soup")
    await user.clear(item)
    await user.type(item, "Broth")
    await closeItem(user)

    await user.click(screen.getByRole("button", { name: "Discard edits" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText("Discard your changes?")
    ).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole("button", { name: "Keep editing" })
    )
    expect(
      screen.getByRole("button", { name: "Edit Broth" })
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Save here" }))
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1))
    expect(saveSpy.mock.calls[0]![1]).toMatchObject({
      expectedCanonicalRevision: "4",
    })
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it("shows a clear notice when the location cannot have a food menu", () => {
    useMenuMock.mockReturnValue({
      data: makeMenus({ eligible: false }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(
      screen.getByText("This location can’t have a food menu", { exact: false })
    ).toBeInTheDocument()
  })
})

describe("emptying the menu and read-only roles", () => {
  function loaded(state: FoodMenusState, caps: Record<string, unknown>) {
    useMenuMock.mockReturnValue({
      data: state,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({ data: caps })
  }

  it("keeps the editor and Undo after removing the last section", async () => {
    const user = userEvent.setup()
    loaded(
      makeMenus({
        googleCounts: { menus: 1, sections: 1, items: 1, options: 0 },
      }),
      { canEditCanonical: true, canPublish: true }
    )
    renderTab()
    await user.click(
      screen.getByRole("button", { name: "Actions for section Starters" })
    )
    await user.click(
      await screen.findByRole("menuitem", { name: "Remove section" })
    )
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remove section",
      })
    )
    expect(
      screen.queryByRole("heading", { name: "No food menu yet" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Start with a section" })
    ).toBeInTheDocument()
    // Said before review, not claimed as a result.
    expect(
      screen.getByText(
        /This draft has no sections, so publishing it would leave Google with no food menu\./
      )
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Undo removal" }))
    expect(screen.getByDisplayValue("Starters")).toBeInTheDocument()
    expect(
      screen.queryByText(/would leave Google with no food menu/)
    ).toBeNull()
  })

  it("a member sees the view-only bar, not a disabled Review changes", () => {
    // Google's menu differs from the saved one: an owner would see
    // "Review changes" here.
    loaded(makeMenus(), { canEditCanonical: false, canPublish: false })
    renderTab()
    expect(
      screen.getByText("You can look, but not change this menu")
    ).toBeInTheDocument()
    expect(screen.getByText(/View-only access\./)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Save here" })).toBeNull()
  })

  it("the empty menu doesn't tell a member to start one", () => {
    loaded(makeMenus({ canonicalMenus: [], status: "in_sync" }), {
      canEditCanonical: false,
      canPublish: false,
    })
    renderTab()
    expect(
      screen.getByRole("heading", { name: "No food menu yet" })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Neither NabaPresence nor Google has a food menu for Riverside."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/Start one here/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Start a menu" })).toBeNull()
  })

  it("tells an owner when publishing is switched off, and still lets them save", () => {
    loaded(makeMenus(), {
      canEditCanonical: true,
      canPublish: true,
      resources: {
        menu: { state: "blocked", reasonCode: "publishing_paused" },
      },
    })
    renderTab()
    expect(
      screen.getByText("Publishing to Google is switched off in NabaPresence")
    ).toBeInTheDocument()
    expect(screen.queryByText(/View-only access/)).toBeNull()
    expect(
      screen.getByRole("button", { name: "Review changes" })
    ).toBeDisabled()
  })
})

describe("reviewed menu preconditions", () => {
  it("keeps the reviewed Google hash when saving before publication", async () => {
    const user = userEvent.setup()
    const state = makeMenus()
    useMenuMock.mockReturnValue({
      data: state,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    vi.spyOn(menuApi, "saveFoodMenus").mockResolvedValue({
      saved: true,
      revision: "5",
    })
    vi.spyOn(menuApi, "fetchFoodMenus").mockResolvedValue(
      makeMenus({
        canonicalResource: { revision: "5", updatedAt: "today" },
        googleHash: "changed-after-review",
      })
    )
    const publish = vi
      .spyOn(menuApi, "publishFoodMenus")
      .mockResolvedValue({ status: "published" })
    renderTab()
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    await user.click(screen.getByRole("button", { name: "Publish to Google" }))
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls[0]?.[1].expectedGoogleHash).toBe("gh")
  })
})

describe("menu draft preservation across revisions", () => {
  it("preserves dirty edits after a failed save and a colleague revision", async () => {
    const user = userEvent.setup()
    useMenuMock.mockReturnValue({
      data: makeMenus(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    const save = vi
      .spyOn(menuApi, "saveFoodMenus")
      .mockRejectedValue(new Error("Save failed"))
    const view = renderTab()
    await openItem(user, "Soup")
    const name = screen.getByDisplayValue("Soup")
    await user.clear(name)
    await user.type(name, "My soup")
    await closeItem(user)
    await user.click(screen.getByRole("button", { name: "Save here" }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save here" })).toBeEnabled()
    )
    useMenuMock.mockReturnValue({
      data: makeMenus({
        canonicalResource: { revision: "5", updatedAt: "later" },
      }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    view.rerenderTab()
    expect(
      screen.getByRole("button", { name: "Edit My soup" })
    ).toBeInTheDocument()
    expect(
      screen.getByText("Someone else saved this menu while you were editing")
    ).toBeInTheDocument()
  })
  it("cleans its own verified published revision including price typing keys", async () => {
    const user = userEvent.setup()
    useMenuMock.mockReturnValue({
      data: makeMenus(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    let fresh = makeMenus()
    vi.spyOn(menuApi, "saveFoodMenus").mockImplementation(
      async (_id, input) => {
        fresh = makeMenus({
          canonicalMenus: input.menus,
          googleMenus: input.menus,
          canonicalResource: { revision: "5", updatedAt: "later" },
          status: "in_sync",
        })
        return { saved: true, revision: "5" }
      }
    )
    vi.spyOn(menuApi, "fetchFoodMenus").mockImplementation(async () => fresh)
    const publish = vi
      .spyOn(menuApi, "publishFoodMenus")
      .mockResolvedValue({ status: "published" })
    const view = renderTab()
    await openItem(user, "Soup")
    const price = screen.getByDisplayValue("6.50")
    await user.clear(price)
    await user.type(price, "7.00")
    await closeItem(user)
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    await user.click(screen.getByRole("button", { name: "Publish to Google" }))
    await waitFor(() => expect(publish).toHaveBeenCalled())
    useMenuMock.mockReturnValue({
      data: fresh,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    view.rerenderTab()
    expect(
      screen.queryByText("Someone else saved this menu while you were editing")
    ).not.toBeInTheDocument()
    // Nothing left to save: Save here leaves the bar instead of greying.
    expect(screen.queryByRole("button", { name: "Save here" })).toBeNull()
    // The row reads the stored price, not the typed "7.00".
    expect(
      screen.getByRole("button", { name: "Edit Soup", hidden: true })
    ).toHaveAccessibleDescription("£7")
  })
  it("keeps the find tools off a short menu", () => {
    useMenuMock.mockReturnValue({
      data: makeMenus(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(screen.queryByRole("searchbox", { name: "Search menu" })).toBeNull()
    expect(screen.queryByText(/items shown/)).toBeNull()
  })
  it("offers the find tools once a single section holds more than twelve items", () => {
    const base = makeMenus()
    const menu = base.canonicalMenus[0] as {
      sections: { items: unknown[] }[]
    }
    const item = menu.sections[0]!.items[0]
    useMenuMock.mockReturnValue({
      data: {
        ...base,
        canonicalMenus: [
          {
            ...menu,
            sections: [
              {
                ...menu.sections[0],
                items: Array.from({ length: 13 }, (_, index) => ({
                  ...(item as object),
                  labels: [{ displayName: `Dish ${index + 1}` }],
                })),
              },
            ],
          },
        ],
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(
      screen.getByRole("searchbox", { name: "Search menu" })
    ).toBeInTheDocument()
    expect(
      screen.getByText("13 of 13 items shown · 1 section total")
    ).toBeInTheDocument()
  })
  it("offers the find tools once the menu has three sections", () => {
    useMenuMock.mockReturnValue({
      data: makeLongMenus(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(
      screen.getByRole("searchbox", { name: "Search menu" })
    ).toBeInTheDocument()
    expect(
      screen.getByText("1 of 1 item shown · 3 sections total")
    ).toBeInTheDocument()
  })
  it("keeps typing focus after review and focuses errors only on another attempt", async () => {
    const user = userEvent.setup()
    useMenuMock.mockReturnValue({
      data: makeLongMenus(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    const search = screen.getByRole("searchbox", { name: "Search menu" })
    await user.type(search, "Starters")
    const section = screen.getByRole("textbox", {
      name: "Section name — section 1",
    })
    await user.clear(section)
    expect(section).toHaveFocus()
    expect(search).toHaveValue("Starters")
    await user.type(section, "New section")
    expect(section).toHaveFocus()
    await user.clear(section)
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    expect(
      screen.getByRole("alert", {
        name: "1 problem to fix before saving or publishing",
      })
    ).toHaveFocus()
  })
  it("opens an item's sheet on the field a summary link names", async () => {
    const user = userEvent.setup()
    useMenuMock.mockReturnValue({
      data: makeMenus(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    await openItem(user, "Soup")
    await user.clear(screen.getByDisplayValue("Soup"))
    await closeItem(user)
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    const summary = screen.getByRole("alert", {
      name: "1 problem to fix before saving or publishing",
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    await user.click(
      within(summary).getByRole("link", {
        name: "Starters, item 1: name this item.",
      })
    )
    const field = await screen.findByRole("textbox", {
      name: "Item name — section 1, item 1",
    })
    await waitFor(() => expect(field).toHaveFocus())
    expect(field).toHaveAttribute("aria-invalid", "true")
    expect(
      within(screen.getByRole("dialog")).getByText(
        "Starters, item 1: name this item."
      )
    ).toBeInTheDocument()
  })
})
