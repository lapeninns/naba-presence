import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/setup",
}))
vi.mock("@/lib/api/google-accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/google-accounts")>()),
  fetchGoogleAccounts: vi.fn(async () => {
    throw new Error("Google did not answer")
  }),
}))

import { OnboardingDrafts } from "@/components/setup/onboarding-drafts"

describe("OnboardingDrafts accounts load", () => {
  // The listings card above owns the one announced error and its retry; the
  // drafts section shares the query and only points back to it.
  it("does not repeat a failed accounts load as a second alert", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <OnboardingDrafts
          clientId="client-1"
          connectionId="connection-1"
          onDirtyChange={() => {}}
        />
      </QueryClientProvider>
    )
    const region = screen.getByRole("region", {
      name: "Find your business on Google",
    })
    expect(
      await within(region).findByText(
        "Searching needs your Google accounts. Use Try again above."
      )
    ).toBeInTheDocument()
    expect(within(region).queryByRole("alert")).not.toBeInTheDocument()
    expect(within(region).queryByRole("button")).not.toBeInTheDocument()
  })
})
