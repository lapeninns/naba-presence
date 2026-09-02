import { useQuery } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { queryKeys } from "@/lib/queries/keys"
import { makeQueryClient } from "@/lib/queries/query-client"
import { QueryProvider } from "@/lib/queries/provider"

describe("query keys", () => {
  it("scopes list keys by their inputs", () => {
    expect(queryKeys.reviews("all", { rating: 1 })).toEqual([
      "reviews",
      "all",
      { rating: 1 },
    ])
    expect(queryKeys.reviewDetail("42")).toEqual(["review-detail", "42"])
  })

  it("exposes invalidation prefixes that match their list keys", () => {
    // React Query invalidates by prefix: the *All keys must be exact
    // prefixes of every scoped key they are meant to drop.
    expect(queryKeys.reviews("organisation", { q: "x" }).slice(0, 1)).toEqual([
      ...queryKeys.reviewsAll,
    ])
    expect(queryKeys.reviewCounts("organisation").slice(0, 1)).toEqual([
      ...queryKeys.reviewCountsAll,
    ])
    expect(
      queryKeys
        .locationMedia("loc-1", { page: 2, category: "FOOD", ownership: null })
        .slice(0, 3)
    ).toEqual([...queryKeys.locationMediaAll("loc-1")])
    // …and must not swallow the detail key or another location's media.
    expect(queryKeys.reviewDetail("42")[0]).not.toBe(queryKeys.reviewsAll[0])
    expect(queryKeys.locationMediaAll("loc-2")).not.toEqual(
      queryKeys.locationMedia("loc-1").slice(0, 3)
    )
  })

  it("keys single-invitation lookups by token", () => {
    expect(queryKeys.invitation("tok")).toEqual(["invitation", "tok"])
    // The org invitations list must not be a prefix of a token lookup.
    expect(queryKeys.invitation("tok")[0]).not.toBe(queryKeys.invitations[0])
  })
})

describe("makeQueryClient", () => {
  it("applies the shared defaults", () => {
    const defaults = makeQueryClient().getDefaultOptions()
    expect(defaults.queries?.staleTime).toBe(30_000)
    expect(defaults.queries?.retry).toBe(1)
    expect(defaults.mutations?.retry).toBe(0)
  })
})

function Probe() {
  const { data } = useQuery({
    queryKey: queryKeys.session,
    queryFn: async () => ({ displayName: "Probe user" }),
  })
  return <p>{data?.displayName ?? "loading"}</p>
}

describe("QueryProvider", () => {
  it("provides a working client", async () => {
    render(
      <QueryProvider>
        <Probe />
      </QueryProvider>
    )
    expect(await screen.findByText("Probe user")).toBeInTheDocument()
  })
})
