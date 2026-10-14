import { render, screen, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { StepDone } from "@/components/setup/step-done"
import type { SetupFacts } from "@/lib/setup/steps"

const facts: SetupFacts = {
  connection: { id: "conn-1", status: "active" },
  accountsActive: 2,
  locationsLinked: 3,
  backfill: "failed",
  notificationsEnabled: false,
  teamInvited: false,
} as SetupFacts

describe("StepDone", () => {
  it("summarises what was set up as settings rows, one per fact", () => {
    render(
      <StepDone
        clientId="c1"
        clientName="Old Crown Group"
        business={false}
        facts={facts}
      />
    )
    const summary = screen.getByTestId("setup-summary")
    const rows = within(summary).getAllByRole("listitem")
    expect(rows).toHaveLength(6)
    expect(rows[0]).toHaveTextContent("Google login")
    expect(rows[0]).toHaveTextContent("Connected")
    expect(rows[1]).toHaveTextContent("Business Profile accounts")
    expect(rows[1]).toHaveTextContent("2 selected")
    expect(rows[2]).toHaveTextContent("Listings linked")
    expect(rows[2]).toHaveTextContent("3")
    // A stopped import says so in words, with where to retry it.
    expect(rows[3]).toHaveTextContent("Review import")
    expect(rows[3]).toHaveTextContent("Stopped")
    expect(rows[4]).toHaveTextContent("Real-time notifications")
    expect(rows[4]).toHaveTextContent("Off")
    expect(rows[5]).toHaveTextContent("Only you so far")
  })

  it("offers the client, its inbox and its listings for an agency", () => {
    render(
      <StepDone
        clientId="c1"
        clientName="Old Crown Group"
        business={false}
        facts={facts}
      />
    )
    expect(
      screen.getByRole("link", { name: "Open the client" })
    ).toHaveAttribute("href", "/clients/c1")
    expect(
      screen.getByRole("link", { name: "Open the inbox" })
    ).toHaveAttribute("href", "/inbox?clientId=c1")
    expect(
      screen.getByRole("link", { name: "Open its listings" })
    ).toHaveAttribute("href", "/listings?clientId=c1")
  })
})
