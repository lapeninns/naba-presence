import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { DivergenceBanner } from "@/components/reporting/divergence-banner"

describe("DivergenceBanner", () => {
  it("renders only when divergence is true", () => {
    const { rerender, container } = render(
      <DivergenceBanner
        providerTotals={{
          averageRating: 4.4,
          totalReviewCount: 51,
          localReviewCount: 42,
          divergence: false,
        }}
      />
    )
    expect(container).toBeEmptyDOMElement()
    rerender(
      <DivergenceBanner
        providerTotals={{
          averageRating: 4.4,
          totalReviewCount: 51,
          localReviewCount: 42,
          divergence: true,
        }}
      />
    )
    expect(screen.getByText(/may be incomplete/i)).toBeInTheDocument()
  })
})
