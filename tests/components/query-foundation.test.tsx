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
