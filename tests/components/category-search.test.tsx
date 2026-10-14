import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { CategorySearch } from "@/components/locations/business-information/category-search"

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
})
