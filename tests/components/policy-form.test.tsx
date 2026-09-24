import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PolicyForm } from "@/components/settings/policy-form"
import { Toaster } from "@/components/ui/toast"
import type { OrgSettings } from "@/lib/api/settings"

const useSettingsMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-settings", () => ({
  useSettings: () => useSettingsMock(),
}))
vi.mock("@/lib/queries/use-settings-capabilities", () => ({
  useSettingsCapabilities: () => useCapsMock(),
}))

function makeSettings(overrides: Partial<OrgSettings> = {}): OrgSettings {
  return {
    approvalRequired: true,
    requireTwoPersonApproval: false,
    rawContentRetentionDays: 14,
    defaultLanguageCode: "en-GB",
    defaultTimezone: "Europe/London",
    directPublishConsentAt: null,
    ...overrides,
  }
}

function renderForm(role: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <PolicyForm role={role} />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("PolicyForm", () => {
  it("renders the current policy and enables save once an owner edits", () => {
    useSettingsMock.mockReturnValue({
      data: makeSettings(),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: {
        canManageTeam: true,
        canManageConnections: true,
        canEditSettings: true,
      },
    })
    renderForm("owner")
    const retention = screen.getByRole("spinbutton", {
      name: "Days to keep raw review content",
    })
    expect(retention).toHaveValue(14)
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    fireEvent.change(retention, { target: { value: "7" } })
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled()
  })

  it("disables everything with a reason for a member (read-only)", () => {
    useSettingsMock.mockReturnValue({
      data: makeSettings(),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: {
        canManageTeam: false,
        canManageConnections: false,
        canEditSettings: false,
      },
    })
    renderForm("member")
    expect(
      screen.getByRole("spinbutton", {
        name: "Days to keep raw review content",
      })
    ).toBeDisabled()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    expect(
      screen.getByText("Only owners and admins can change these settings.")
    ).toBeInTheDocument()
  })

  it("blocks turning off approval unless an owner confirms consent", () => {
    useSettingsMock.mockReturnValue({
      data: makeSettings(),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: {
        canManageTeam: true,
        canManageConnections: true,
        canEditSettings: true,
      },
    })
    // Admin turns approval off -> the consent switch is owner-only, save stays blocked.
    renderForm("admin")
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Require approval before replies publish",
      })
    )
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    expect(
      screen.getByText(
        "Only an owner can turn off approval before replies publish."
      )
    ).toBeInTheDocument()
  })

  it("lets an admin save other fields when direct publishing is already on", () => {
    useSettingsMock.mockReturnValue({
      data: makeSettings({ approvalRequired: false }),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: {
        canManageTeam: true,
        canManageConnections: true,
        canEditSettings: true,
      },
    })
    renderForm("admin")
    expect(
      screen.queryByRole("checkbox", {
        name: "I confirm replies may publish to Google without approval",
      })
    ).not.toBeInTheDocument()
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "Days to keep raw review content",
      }),
      { target: { value: "7" } }
    )
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled()
  })
})
