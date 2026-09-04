import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewFilters } from "@/components/inbox/review-filters"
import { REVIEW_SORT_LABELS } from "@/lib/contracts/reviews"

afterEach(() => vi.restoreAllMocks())

describe("ReviewFilters", () => {
  it("exposes search, sort, and inline rating without a filter dialog", () => {
    render(
      <ReviewFilters
        state={{
          queue: "all",
          locationIds: [],
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
    expect(screen.getByRole("combobox", { name: "Sort reviews" })).toBeInTheDocument()
    // The trigger label comes from the contract's sort vocabulary.
    expect(
      screen.getByRole("combobox", { name: "Sort reviews" })
    ).toHaveTextContent(REVIEW_SORT_LABELS.updated_desc)
    expect(screen.getByRole("checkbox", { name: "5 stars" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /More filters/ })).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("combobox", { name: "Filter by rating" })
    ).not.toBeInTheDocument()
  })

  it("hides the location combobox for a single-location org but keeps a stale filter clearable", () => {
    render(
      <ReviewFilters
        state={{
          queue: "all",
          locationIds: ["loc-1"],
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
