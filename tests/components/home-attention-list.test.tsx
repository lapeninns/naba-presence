import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AttentionList } from "@/components/home/attention-list"

describe("AttentionList", () => {
  it("links each row to the location's low-rated reviews in the inbox", () => {
    render(
      <AttentionList
        locations={[
          {
            id: "loc-9",
            name: "Harbour View",
            reviews: 5,
            averageRating: 2.1,
            responseRate: 50,
            medianFirstResponseSeconds: null,
            p95FirstResponseSeconds: null,
            medianLatestEditSeconds: null,
            unresolvedComplaints: 4,
            verificationRejectionRate: null,
          },
        ]}
      />
    )
    const link = screen.getByRole("link", { name: /Harbour View/ })
    expect(link).toHaveAttribute("href", "/inbox?locationId=loc-9&rating=1,2")
    expect(
      screen.getByText(/1–2 star reviews with no published reply/i)
    ).toBeInTheDocument()
  })

  it("says so when nothing needs attention", () => {
    render(<AttentionList locations={[]} />)
    expect(
      screen.getByText(
        /No locations have unresolved low ratings in the last 30 days/i
      )
    ).toBeInTheDocument()
  })
})
