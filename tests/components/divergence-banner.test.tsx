import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { DivergenceBanner } from "@/components/reporting/divergence-banner"

const totals = (divergence: boolean) => ({
  averageRating: 4.4,
  totalReviewCount: 51,
  localReviewCount: 42,
  divergence,
})

describe("DivergenceBanner", () => {
  it("renders only when divergence is true", () => {
    const { rerender, container } = render(
      <DivergenceBanner providerTotals={totals(false)} />
    )
    expect(container).toBeEmptyDOMElement()
    rerender(<DivergenceBanner providerTotals={totals(true)} />)
    expect(screen.getByText(/may be incomplete/i)).toBeInTheDocument()
  })

  it("speaks to the operator internally and to the client publicly", () => {
    const { container, rerender } = render(
      <DivergenceBanner divergent audience="internal" />
    )
    const banner = () =>
      container.querySelector('[data-slot="alert"]') as HTMLElement
    expect(banner()).toHaveTextContent(
      /than we have collected so far.*syncing catches up/
    )
    // Present when the report loads, so it is read in place rather than
    // interrupting as an alert (prim-19).
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    rerender(<DivergenceBanner divergent audience="public" />)
    const alert = banner()
    expect(alert).toHaveTextContent(/may not be counted yet/)
    // No "we" and no sync jargon on the client's page.
    expect(alert.textContent).not.toMatch(/\bwe\b|sync/i)
  })

  it("draws nothing for a report that is not divergent", () => {
    const { container } = render(
      <DivergenceBanner divergent={false} audience="public" />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
