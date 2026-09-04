import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { SetupChecklistCard } from "@/components/home/setup-checklist-card"
import * as clientsHook from "@/lib/queries/use-clients"
import type { SetupStep } from "@/lib/contracts/clients"

function stub({
  nextStep,
  clients = [
    { id: "c1", name: "Old Crown Group", createdAt: "2026-01-01T00:00:00.000Z" },
  ],
}: {
  nextStep: SetupStep
  clients?: { id: string; name: string; createdAt: string }[]
}) {
  vi.spyOn(clientsHook, "useClients").mockReturnValue({
    data: { items: clients },
  } as unknown as ReturnType<typeof clientsHook.useClients>)
  vi.spyOn(clientsHook, "useClientSetup").mockReturnValue({
    data: { setup: { nextStep } },
  } as unknown as ReturnType<typeof clientsHook.useClientSetup>)
}

afterEach(() => vi.restoreAllMocks())

describe("SetupChecklistCard", () => {
  it("names the client and the next thing to do", () => {
    stub({ nextStep: "locations" })
    render(<SetupChecklistCard role="owner" />)
    expect(
      screen.getByRole("heading", { name: "Finish setting up Old Crown Group" })
    ).toBeInTheDocument()
    expect(screen.getByText(/link this client's locations/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Continue setup" })).toHaveAttribute(
      "href",
      "/setup?client=c1&step=locations"
    )
  })

  it("disappears once setup is finished", () => {
    // A permanent checklist becomes furniture nobody reads.
    stub({ nextStep: "done" })
    const { container } = render(<SetupChecklistCard role="owner" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows nothing to someone who cannot run setup", () => {
    stub({ nextStep: "connect" })
    const { container } = render(<SetupChecklistCard role="member" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("tracks the first client, not whichever was added last", () => {
    // A later client's half-finished setup belongs on that client's own page.
    stub({
      nextStep: "connect",
      clients: [
        { id: "new", name: "Cam Cycles", createdAt: "2026-09-01T00:00:00.000Z" },
        { id: "old", name: "Old Crown Group", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
    })
    render(<SetupChecklistCard role="owner" />)
    expect(
      screen.getByRole("heading", { name: "Finish setting up Old Crown Group" })
    ).toBeInTheDocument()
  })
})
