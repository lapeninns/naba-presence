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

  it("hides the location combobox for a single-location org but keeps a stale filter clearable", () => {
    render(
      <ReviewFilters
        state={{
          queue: "all",
          locationId: "loc-1",
          ratings: [],
          search: "",
          sort: "updated_desc",
          verification: [],
          publishStatus: [],
          syncStatus: [],
        }}
        locations={[{ id: "loc-1", name: "Riverside" }]}
        showLocationFilter={false}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    expect(
      screen.queryByRole("combobox", { name: "Filter by location" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "Search reviews" })).toBeInTheDocument()
    // components/home/attention-list.tsx links to /inbox?locationId=… for any
    // org, so a single-location user can land here already filtered. With the
    // combobox gone, this chip is the only way back out — it must survive.
    expect(
      screen.getByRole("button", { name: "Remove location filter" })
    ).toBeInTheDocument()
  })
})
