import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ReplyLocationsTable } from "@/components/performance/reply-locations-table"

describe("ReplyLocationsTable nulls-last honest-null (spec §8)", () => {
  it("sorts rows with null response rate last and renders — for nulls", () => {
    render(
      <ReplyLocationsTable
        timezone="Europe/London"
        locations={[
          { id: "a", name: "Alpha", reviews: 3, averageRating: 4.2, responseRate: null, medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null, unresolvedComplaints: 0, verificationRejectionRate: null },
          { id: "b", name: "Bravo", reviews: 9, averageRating: 4.8, responseRate: 91, medianFirstResponseSeconds: 3600, p95FirstResponseSeconds: null, medianLatestEditSeconds: null, unresolvedComplaints: 1, verificationRejectionRate: null },
        ]}
      />
    )
    const rows = screen.getAllByRole("row").slice(1) // drop header
    expect(within(rows[0]).getByText("Bravo")).toBeInTheDocument() // non-null response rate first
    expect(within(rows[1]).getByText("Alpha")).toBeInTheDocument() // null last
    expect(within(rows[1]).getAllByText("—").length).toBeGreaterThan(0)
  })
})
