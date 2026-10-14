import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import {
  CategoryPickerSheet,
  CategorySearch,
} from "@/components/locations/business-information/category-search"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("CategorySearch", () => {
  it("offers Google's categories as options and hands the pick back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          result: {
            categories: [{ name: "categories/gcid:spa", displayName: "Spa" }],
          },
        })
      )
    )
    const onSelect = vi.fn()
    renderWithProviders(
      <CategorySearch
        locationId="loc-1"
        label="Add another category"
        disabled={false}
        onSelect={onSelect}
      />
    )
    const input = screen.getByLabelText("Add another category")
    await userEvent.type(input, "spa")
    await userEvent.click(await screen.findByRole("option", { name: "Spa" }))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "categories/gcid:spa" })
    )
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("says a failed search failed, rather than showing it as no categories", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "upstream" }, 502))
    )
    renderWithProviders(
      <CategorySearch
        locationId="loc-1"
        label="Add another category"
        disabled={false}
        onSelect={() => {}}
      />
    )
    const input = screen.getByLabelText("Add another category")
    await userEvent.type(input, "spa")
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(
      "Google categories could not be loaded. Change the search to try again."
    )
    await waitFor(() =>
      expect(input).toHaveAttribute("aria-describedby", alert.id)
    )
  })

  it("picks a primary category from the phone's search sheet and closes it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          result: {
            categories: [{ name: "categories/gcid:spa", displayName: "Spa" }],
          },
        })
      )
    )
    const onSelect = vi.fn()
    const onOpenChange = vi.fn()
    renderWithProviders(
      <CategoryPickerSheet
        locationId="loc-1"
        title="Change primary category"
        type="single"
        open
        onOpenChange={onOpenChange}
        isSelected={() => false}
        onSelect={onSelect}
      />
    )
    const sheet = await screen.findByRole("dialog", {
      name: "Change primary category",
    })
    await userEvent.type(
      within(sheet).getByLabelText("Search Google categories"),
      "spa"
    )
    await userEvent.click(
      await within(sheet).findByRole("option", { name: "Spa" })
    )
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "categories/gcid:spa" })
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("ticks additional categories already in the draft and says why one can't be added", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          result: {
            categories: [
              { name: "categories/gcid:spa", displayName: "Spa" },
              { name: "categories/gcid:pool", displayName: "Pool" },
            ],
          },
        })
      )
    )
    const onDeselect = vi.fn()
    renderWithProviders(
      <CategoryPickerSheet
        locationId="loc-1"
        title="Add another category"
        type="multiple"
        open
        onOpenChange={() => {}}
        isSelected={(category) => category.name === "categories/gcid:spa"}
        unavailable={(category) =>
          category.name === "categories/gcid:pool"
            ? "A category can’t be both primary and additional."
            : null
        }
        onSelect={() => {}}
        onDeselect={onDeselect}
      />
    )
    const sheet = await screen.findByRole("dialog", {
      name: "Add another category",
    })
    await userEvent.type(
      within(sheet).getByLabelText("Search Google categories"),
      "s"
    )
    const spa = await within(sheet).findByRole("checkbox", { name: "Spa" })
    expect(spa).toHaveAttribute("aria-checked", "true")
    const pool = within(sheet).getByRole("checkbox", { name: "Pool" })
    expect(pool).toBeDisabled()
    expect(pool).toHaveAccessibleDescription(
      "A category can’t be both primary and additional."
    )
    await userEvent.click(spa)
    expect(onDeselect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "categories/gcid:spa" })
    )
  })
})
