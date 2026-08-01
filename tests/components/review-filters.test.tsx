import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewFilters } from "@/components/inbox/review-filters"

afterEach(() => vi.restoreAllMocks())

describe("ReviewFilters", () => {
  it("exposes a labelled location combobox and a search box", () => {
    render(
      <ReviewFilters
        state={{
          queue: "all",
          ratings: [],
          search: "",
          sort: "updated_desc",
          verification: [],
          publishStatus: [],
          syncStatus: [],
        }}
        locations={[{ id: "loc-1", name: "Riverside" }]}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    expect(
      screen.getByRole("combobox", { name: "Filter by location" })
    ).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "Search reviews" })).toBeInTheDocument()
  })
})
