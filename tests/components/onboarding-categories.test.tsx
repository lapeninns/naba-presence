import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"

vi.mock("@/lib/api/google-onboarding-categories", () => ({
  fetchOnboardingCategories: vi.fn(async () => ({
    categories: [
      { name: "categories/gcid:shop", displayName: "Shop" },
      { name: "categories/gcid:florist", displayName: "Florist" },
    ],
  })),
}))

import { OnboardingCategories } from "@/components/setup/onboarding-categories"

const draft = {
  accountId: "accounts/1",
  connectionId: "4b0c7f0e-6f1d-4c55-9a43-1f8e1f2b7a10",
  clientId: null,
} as unknown as GoogleOnboardingDraft

// Each result's action is named "<visible words>: <category>" as ONE text
// run. The visible words are aria-hidden and the sr-only span repeats them,
// because an sr-only sibling is block-level and Chromium would otherwise
// name the button "Set primary : Shop" (a space before the colon).
describe("OnboardingCategories result actions", () => {
  it("names each action as one run with the category", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OnboardingCategories
          draft={draft}
          regionCode="GB"
          languageCode="en"
          value={null as never}
          onChange={() => {}}
        />
      </QueryClientProvider>
    )
    await userEvent.type(screen.getByRole("textbox"), "shop")
    await userEvent.click(
      screen.getByRole("button", { name: "Find categories" })
    )

    const primary = await screen.findByRole("button", {
      name: "Set primary: Shop",
    })
    const add = screen.getByRole("button", { name: "Add category: Florist" })
    for (const button of [primary, add]) {
      const [visible, spoken] = Array.from(button.querySelectorAll("span"))
      expect(visible).toHaveAttribute("aria-hidden", "true")
      expect(spoken).toHaveClass("sr-only")
      expect(spoken.textContent).toBe(
        `${visible.textContent}: ${spoken.textContent?.split(": ")[1]}`
      )
    }
  })
})
