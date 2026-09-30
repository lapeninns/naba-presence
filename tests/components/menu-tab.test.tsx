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
    expect(screen.getByDisplayValue("Soup")).toBeInTheDocument()
    expect(screen.getByDisplayValue("6.50")).toBeInTheDocument()
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

    const item = screen.getByDisplayValue("Soup")
    await user.clear(item)
    await user.type(item, "Broth")

    await user.click(screen.getByRole("button", { name: "Discard" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText("Discard your changes?")
    ).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole("button", { name: "Keep editing" })
    )
    expect(screen.getByDisplayValue("Broth")).toBeInTheDocument()

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
    const name = screen.getByDisplayValue("Soup")
    await user.clear(name)
    await user.type(name, "My soup")
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
    expect(screen.getByDisplayValue("My soup")).toBeInTheDocument()
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
    const price = screen.getByDisplayValue("6.50")
    await user.clear(price)
    await user.type(price, "7.00")
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
    expect(screen.getByRole("button", { name: "Save here" })).toBeDisabled()
    expect(screen.getByDisplayValue("7")).toBeInTheDocument()
  })
  it("keeps typing focus after review and focuses errors only on another attempt", async () => {
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
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    const search = screen.getByRole("searchbox", { name: "Search menu" })
    await user.type(search, "Starters")
    const section = screen.getByRole("textbox", { name: "Section 1 name" })
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
})
