import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PolicyForm } from "@/components/settings/policy-form"
import { Toaster } from "@/components/ui/toast"
import type { OrgSettings } from "@/lib/api/settings"

const useSettingsMock = vi.fn()
const saveSettingsMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/settings", () => ({
  saveSettings: saveSettingsMock,
}))
const renameMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/session", () => ({
  renameOrganisation: renameMock,
}))
const refresh = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh,
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/settings/policy",
}))
let sessionRole = "owner"
vi.mock("@/lib/queries/use-session", () => ({
  useSession: () => ({
    data: {
      session: {
        role: sessionRole,
        organisationName: "Acme Reviews",
        workspaceMode: "agency",
      },
    },
  }),
}))
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
  sessionRole = role
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
    // A clean form shows no save bar at all (settings-setup-auth-07/m2).
    expect(
      screen.queryByRole("region", { name: "Save reply policy" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Save changes" })
    ).not.toBeInTheDocument()
    fireEvent.change(retention, { target: { value: "7" } })
    const bar = screen.getByRole("region", { name: "Save reply policy" })
    // Docked to a phone's bottom edge through the chrome contract: the
    // ActionBar's `dock`, fixed on a phone with an in-flow spacer.
    expect(bar).toHaveAttribute("data-docked", "bottom")
    expect(bar.className).toMatch(/max-md:fixed/)
    expect(
      bar.parentElement?.querySelector('[data-slot="action-bar-spacer"]')
    ).not.toBeNull()
    expect(within(bar).getByRole("button", { name: "Discard" })).toBeEnabled()
    expect(bar).toHaveTextContent("1 unsaved change")
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled()
    // Discarding returns to a clean form, and the bar goes away again.
    fireEvent.click(screen.getByRole("button", { name: "Discard" }))
    expect(
      screen.queryByRole("region", { name: "Save reply policy" })
    ).not.toBeInTheDocument()
    // Nothing docked is left behind for the tab bar to step aside for.
    expect(document.querySelector('[data-docked="bottom"]')).toBeNull()
    expect(document.querySelector('[data-slot="action-bar-spacer"]')).toBeNull()
  })

  it("links each switch's hint to it as its description", () => {
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
    expect(
      screen.getByRole("switch", {
        name: "Require approval before replies publish",
      })
    ).toHaveAccessibleDescription(
      "Replies from people who can’t publish wait in the Approval queue for someone who can."
    )
    expect(
      screen.getByRole("switch", {
        name: "Require a second person to approve each reply",
      })
    ).toHaveAccessibleDescription(
      "The person who asked for approval can’t approve their own reply."
    )
  })

  it("keeps a refused save's reason in the bar, beside the button", async () => {
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
    saveSettingsMock.mockRejectedValue(new Error("boom"))
    renderForm("owner")
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "Days to keep raw review content",
      }),
      { target: { value: "7" } }
    )
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    const bar = await screen.findByRole("region", { name: "Save reply policy" })
    expect(await within(bar).findByText("Not saved")).toBeInTheDocument()
    // The edit survives the refusal.
    expect(
      screen.getByRole("spinbutton", {
        name: "Days to keep raw review content",
      })
    ).toHaveValue(7)
  })

  it("shows the load error with a retry instead of the form", () => {
    const refetch = vi.fn()
    useSettingsMock.mockReturnValue({
      data: undefined,
      error: new Error("down"),
      isPending: false,
      isError: true,
      refetch,
    })
    useCapsMock.mockReturnValue({ data: undefined })
    renderForm("owner")
    expect(
      screen.getByText("We couldn’t load your settings")
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalled()
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
    // No save bar for someone who can't edit; the note says why.
    expect(
      screen.queryByRole("button", { name: "Save changes" })
    ).not.toBeInTheDocument()
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

  it("names the language and timezone in words, not codes", () => {
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
    expect(screen.getByText("English (UK)")).toBeInTheDocument()
    expect(
      screen.getByRole("combobox", { name: "Default timezone" })
    ).toHaveValue("Europe / London")
  })

  describe("the name, on the same save bar (finding m1)", () => {
    function editable() {
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
    }
    const nameField = () => screen.getByRole("textbox", { name: "Agency name" })

    it("saves only the name when only the name changed", async () => {
      editable()
      renameMock.mockResolvedValue({ name: "Acme Local" })
      renderForm("owner")
      expect(nameField()).toHaveValue("Acme Reviews")
      fireEvent.change(nameField(), { target: { value: "  Acme Local " } })
      const bar = screen.getByRole("region", { name: "Save reply policy" })
      expect(bar).toHaveTextContent("1 unsaved change · Name")
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
      await waitFor(() => expect(renameMock).toHaveBeenCalledWith("Acme Local"))
      expect(saveSettingsMock).not.toHaveBeenCalled()
      expect(await screen.findByText("Settings saved")).toBeInTheDocument()
      expect(refresh).toHaveBeenCalled()
      await waitFor(() =>
        expect(
          screen.queryByRole("region", { name: "Save reply policy" })
        ).not.toBeInTheDocument()
      )
    })

    it("saves the name and the policy together, each with its own body", async () => {
      editable()
      renameMock.mockResolvedValue({ name: "Acme Local" })
      saveSettingsMock.mockResolvedValue(
        makeSettings({ rawContentRetentionDays: 7 })
      )
      renderForm("owner")
      fireEvent.change(nameField(), { target: { value: "Acme Local" } })
      fireEvent.change(
        screen.getByRole("spinbutton", {
          name: "Days to keep raw review content",
        }),
        { target: { value: "7" } }
      )
      expect(
        screen.getByRole("region", { name: "Save reply policy" })
      ).toHaveTextContent("2 unsaved changes · Name, Retention")
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
      await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(1))
      expect(saveSettingsMock.mock.calls[0][0]).toEqual({
        approvalRequired: true,
        requireTwoPersonApproval: false,
        rawContentRetentionDays: 7,
        defaultLanguageCode: "en-GB",
        defaultTimezone: "Europe/London",
        directPublishConsent: false,
      })
      expect(renameMock).toHaveBeenCalledWith("Acme Local")
      expect(await screen.findByText("Settings saved")).toBeInTheDocument()
    })

    it("keeps a refused name beside its field and in the bar", async () => {
      editable()
      renameMock.mockRejectedValue(new Error("boom"))
      renderForm("owner")
      fireEvent.change(nameField(), { target: { value: "Acme Local" } })
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
      const bar = await screen.findByRole("region", {
        name: "Save reply policy",
      })
      expect(await within(bar).findByText("Not saved")).toBeInTheDocument()
      expect(bar).toHaveTextContent("Agency name:")
      expect(nameField()).toHaveValue("Acme Local")
      expect(nameField()).toHaveAttribute("aria-invalid", "true")
      expect(screen.queryByText("Settings saved")).not.toBeInTheDocument()
    })

    it("blocks an empty name with the reason at the field", () => {
      editable()
      renderForm("owner")
      fireEvent.change(nameField(), { target: { value: "   " } })
      expect(
        screen.getByRole("button", { name: "Save changes" })
      ).toBeDisabled()
      expect(
        screen.getByRole("region", { name: "Save reply policy" })
      ).toHaveTextContent("Fix the marked fields to save.")
      expect(screen.getByText("Enter your agency’s name.")).toBeInTheDocument()
    })

    it("is read-only for an admin, and never makes the page dirty", () => {
      editable()
      renderForm("admin")
      expect(nameField()).toHaveAttribute("readonly")
      expect(
        screen.getByText("Only an owner can rename the agency.")
      ).toBeInTheDocument()
      fireEvent.change(nameField(), { target: { value: "Other" } })
      expect(
        screen.queryByRole("region", { name: "Save reply policy" })
      ).not.toBeInTheDocument()
    })
  })
})
