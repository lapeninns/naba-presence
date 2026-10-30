import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

// The keyboard-safety hook is the editors' own (keep-focus-clear.test.tsx);
// here only its wiring to the form is checked.
const keepFocusClear = vi.hoisted(() => vi.fn())
vi.mock("@/lib/editors/use-keep-focus-clear", () => ({
  useKeepFocusClear: keepFocusClear,
}))

import { PolicyForm } from "@/components/settings/policy-form"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
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
    bannedPhrases: [],
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

const retentionSelect = () =>
  screen.getByRole("combobox", { name: "How long we keep review text" })

async function chooseRetention(label: string) {
  await userEvent.click(retentionSelect())
  await userEvent.click(await screen.findByRole("option", { name: label }))
}

afterEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe("PolicyForm", () => {
  it("lets an admin save phrases as trimmed lines and clear the list", async () => {
    useSettingsMock.mockReturnValue({
      data: makeSettings({ bannedPhrases: ["Old phrase"] }),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({ data: { canEditSettings: true } })
    saveSettingsMock.mockResolvedValue(
      makeSettings({ bannedPhrases: ["No refunds", "Guaranteed"] })
    )
    renderForm("admin")
    const phrases = screen.getByRole("textbox", { name: "Phrases to block" })
    expect(phrases).toHaveValue("Old phrase")
    fireEvent.change(phrases, {
      target: { value: " No refunds \n\nGuaranteed " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(1))
    expect(saveSettingsMock.mock.calls[0][0]).toMatchObject({
      bannedPhrases: ["No refunds", "Guaranteed"],
    })
    await waitFor(() => expect(phrases).toHaveValue("No refunds\nGuaranteed"))
    saveSettingsMock.mockResolvedValue(makeSettings())
    fireEvent.change(phrases, { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(2))
    expect(saveSettingsMock.mock.calls[1][0]).toMatchObject({
      bannedPhrases: [],
    })
  })

  it("keeps phrases read-only when the role cannot edit settings", () => {
    useSettingsMock.mockReturnValue({
      data: makeSettings({ bannedPhrases: ["No refunds"] }),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({ data: { canEditSettings: false } })
    renderForm("member")
    expect(
      screen.getByRole("textbox", { name: "Phrases to block" })
    ).toBeDisabled()
  })

  it("renders the current policy and enables save once an owner edits", async () => {
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
    const retention = retentionSelect()
    expect(retention).toHaveTextContent("14 days")
    // A clean form shows no save bar at all (settings-setup-auth-07/m2).
    expect(
      screen.queryByRole("region", { name: "Save reply policy" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Save changes" })
    ).not.toBeInTheDocument()
    await chooseRetention("7 days")
    const bar = screen.getByRole("region", { name: "Save reply policy" })
    // Docked to a phone's bottom edge through the chrome contract: the
    // ActionBar's `dock`, fixed on a phone with an in-flow spacer.
    expect(bar).toHaveAttribute("data-docked", "bottom")
    expect(bar.className).toMatch(/max-md:fixed/)
    // A local save: the light bar, not the dark one kept for Google.
    expect(bar).toHaveAttribute("data-bar-tone", "surface")
    // The change list gets its own row on a phone, so "1 unsaved change ·
    // Review text" isn't cut short beside the buttons.
    expect(
      bar.querySelector('[data-slot="action-bar-status"]')?.className
    ).toMatch(/max-md:basis-full/)
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

  it("keeps a focused field clear of the docked save bar's measured top", () => {
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
    const form = screen.getByRole("form", { name: "Reply policy" })
    // Wired to the mounted form (past its loading states) and to the bar
    // inside it: with a phone keyboard up the browser alone leaves a field
    // that is above the keyboard but under the bar.
    const wired = keepFocusClear.mock.calls.filter(
      ([ref]) => (ref as { current: Element | null }).current === form
    )
    expect(wired.length).toBeGreaterThan(0)
    expect(wired.at(-1)?.[1]).toBe("[data-slot=action-bar]")
  })

  it("links the second-person switch's hint to it as its description", () => {
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
        name: "Require a second person to approve each reply",
      })
    ).toHaveAccessibleDescription(
      "The person who asked for approval can’t approve their own reply."
    )
  })

  describe("the retention choice and the approval note", () => {
    function open(
      overrides: Partial<OrgSettings> = {},
      canEditSettings = true
    ) {
      useSettingsMock.mockReturnValue({
        data: makeSettings(overrides),
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      })
      useCapsMock.mockReturnValue({
        data: {
          canManageTeam: canEditSettings,
          canManageConnections: canEditSettings,
          canEditSettings,
        },
      })
    }
    const alertsIn = () =>
      screen
        .getByRole("form", { name: "Reply policy" })
        .querySelectorAll('[data-slot="alert"]')
    const optionLabels = async () =>
      (await screen.findAllByRole("option")).map((option) => option.textContent)

    it("labels the field in plain words, as a select and not a number box", () => {
      open()
      renderForm("owner")
      expect(
        screen.getByRole("combobox", { name: "How long we keep review text" })
      ).toBeInTheDocument()
      expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument()
      expect(screen.queryByText(/raw review content/i)).not.toBeInTheDocument()
      expect(
        screen.getByText(
          "After this, the text is deleted here; it stays on Google."
        )
      ).toBeInTheDocument()
    })

    it("offers the presets, and sends the chosen days as a number", async () => {
      open()
      saveSettingsMock.mockResolvedValue(
        makeSettings({ rawContentRetentionDays: 30 })
      )
      renderForm("owner")
      await userEvent.click(retentionSelect())
      expect(await optionLabels()).toEqual(["7 days", "14 days", "30 days"])
      await userEvent.click(screen.getByRole("option", { name: "30 days" }))
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
      await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(1))
      expect(saveSettingsMock.mock.calls[0][0]).toMatchObject({
        rawContentRetentionDays: 30,
      })
    })

    it("keeps a saved value that is not a preset, selected and listed, and changes nothing", async () => {
      open({ rawContentRetentionDays: 21 })
      renderForm("owner")
      expect(retentionSelect()).toHaveTextContent("21 days")
      // Opening the page is not an edit.
      expect(
        screen.queryByRole("region", { name: "Save reply policy" })
      ).not.toBeInTheDocument()
      await userEvent.click(retentionSelect())
      expect(await optionLabels()).toEqual([
        "7 days",
        "14 days",
        "21 days",
        "30 days",
      ])
      expect(screen.getByRole("option", { name: "21 days" })).toHaveAttribute(
        "aria-selected",
        "true"
      )
    })

    it("says a one-day setting as 1 day", () => {
      open({ rawContentRetentionDays: 1 })
      renderForm("owner")
      expect(retentionSelect()).toHaveTextContent("1 day")
    })

    it("says the approval state once, as one alert, with approval on", () => {
      open()
      renderForm("owner")
      const alerts = alertsIn()
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toHaveTextContent(
        "Replies from people who can’t publish wait in the Approval queue"
      )
      expect(screen.queryByText(/Direct publishing/)).not.toBeInTheDocument()
    })

    it("says it once, with the consequence and the date, when approval is already off", () => {
      open({
        approvalRequired: false,
        directPublishConsentAt: "2026-10-14T09:00:00.000Z",
      })
      renderForm("owner")
      const alerts = alertsIn()
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toHaveTextContent("Replies publish straight to Google")
      expect(alerts[0]).toHaveTextContent("Confirmed on 14 October 2026.")
      expect(alerts[0]).toHaveTextContent(
        "People who can’t publish can’t send replies."
      )
      expect(screen.queryByText(/Direct publishing/)).not.toBeInTheDocument()
    })

    it("says approval is off, and what the two-person rule still does, without claiming non-publishers cannot send", () => {
      open({
        approvalRequired: false,
        requireTwoPersonApproval: true,
        directPublishConsentAt: "2026-10-14T09:00:00.000Z",
      })
      renderForm("owner")
      const alerts = alertsIn()
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toHaveTextContent("Approval is off")
      expect(alerts[0]).toHaveTextContent(
        "Every reply, including one from someone who can publish, waits for a second person to approve it before it reaches Google."
      )
      expect(alerts[0]).toHaveTextContent("Nobody can approve their own reply.")
      expect(alerts[0]).toHaveTextContent("Confirmed on 14 October 2026.")
      expect(alerts[0]).not.toHaveTextContent("can’t send replies")
      expect(alerts[0]).not.toHaveTextContent("straight to Google")
    })

    it("says it in the future tense while approval is being turned off, and in the present once saved", () => {
      open()
      renderForm("owner")
      fireEvent.click(
        screen.getByRole("switch", {
          name: "Require approval before replies publish",
        })
      )
      expect(alertsIn()[0]).toHaveTextContent(
        "Replies will publish straight to Google"
      )
    })

    it("says Approval will be off while turning it off with the two-person rule on", () => {
      open({ requireTwoPersonApproval: true })
      renderForm("owner")
      fireEvent.click(
        screen.getByRole("switch", {
          name: "Require approval before replies publish",
        })
      )
      expect(alertsIn()[0]).toHaveTextContent("Approval will be off")
    })

    it("says nobody can approve their own reply once, with approval on and the two-person rule on", () => {
      open({ requireTwoPersonApproval: true })
      renderForm("owner")
      const form = screen.getByRole("form", { name: "Reply policy" })
      expect(form.textContent?.match(/approve their own reply/g)).toHaveLength(
        1
      )
      expect(alertsIn()[0]).toHaveTextContent(
        "Every reply, including one from someone who can publish"
      )
    })

    it("keeps the one alert, with its confirmation, while turning approval off", () => {
      open()
      renderForm("owner")
      fireEvent.click(
        screen.getByRole("switch", {
          name: "Require approval before replies publish",
        })
      )
      const alerts = alertsIn()
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toHaveTextContent("Only an owner can confirm this.")
      expect(
        within(alerts[0] as HTMLElement).getByRole("checkbox", {
          name: "I confirm replies may publish to Google without approval",
        })
      ).toBeInTheDocument()
    })

    it("says top of the app, not the sidebar, in the name's hint", () => {
      open()
      renderForm("owner")
      expect(
        screen.getByText(
          "What your team sees at the top of the app and what invitations say they are joining."
        )
      ).toBeInTheDocument()
      expect(screen.queryByText(/sidebar/i)).not.toBeInTheDocument()
    })

    it("lists no presets for someone who can only look", () => {
      open({}, false)
      renderForm("member")
      expect(retentionSelect()).toBeDisabled()
      // The read-only note is the one alert here; approval adds its own.
      expect(alertsIn()).toHaveLength(2)
    })
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
    await chooseRetention("7 days")
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    const bar = await screen.findByRole("region", { name: "Save reply policy" })
    expect(await within(bar).findByText("Not saved")).toBeInTheDocument()
    // The edit survives the refusal.
    expect(retentionSelect()).toHaveTextContent("7 days")
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
    expect(retentionSelect()).toBeDisabled()
    // No save bar for someone who can't edit; the note says why.
    expect(
      screen.queryByRole("button", { name: "Save changes" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText("Only owners and admins can change these settings.")
    ).toBeInTheDocument()
  })

  it("names the page's words in the change list", async () => {
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
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Require a second person to approve each reply",
      })
    )
    await chooseRetention("7 days")
    expect(
      screen.getByRole("region", { name: "Save reply policy" })
    ).toHaveTextContent("2 unsaved changes · Second approver, Review text")
  })

  describe("while billing holds the workspace read-only", () => {
    function billingLocked() {
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
          canEditSettings: false,
          canWrite: false,
        },
      })
    }

    it("tells an owner the subscription is the reason, and locks the name too", () => {
      billingLocked()
      renderForm("owner")
      expect(
        screen.getByText(
          "This workspace’s subscription is read-only, so these settings can’t be changed right now."
        )
      ).toBeInTheDocument()
      expect(screen.queryByText(/Ask one of them/)).not.toBeInTheDocument()
      expect(
        screen.queryByText("Only owners and admins can change these settings.")
      ).not.toBeInTheDocument()
      const name = screen.getByRole("textbox", { name: "Agency name" })
      expect(name).toHaveAttribute("readonly")
      expect(
        screen.getByText(
          "The name can’t be changed while the subscription is read-only."
        )
      ).toBeInTheDocument()
      // No edit the page can't save, so nothing arms the leave guard.
      fireEvent.change(name, { target: { value: "Other" } })
      expect(
        screen.queryByRole("region", { name: "Save reply policy" })
      ).not.toBeInTheDocument()
      const reload = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(reload)
      expect(reload.defaultPrevented).toBe(false)
    })

    it("tells an admin the same", () => {
      billingLocked()
      renderForm("admin")
      expect(
        screen.getByText(/subscription is read-only, so these settings/)
      ).toBeInTheDocument()
    })

    it("keeps the role reason for a member", () => {
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
          canWrite: false,
        },
      })
      renderForm("member")
      expect(
        screen.getByText("Only owners and admins can change these settings.")
      ).toBeInTheDocument()
      expect(screen.getByText(/Ask one of them/)).toBeInTheDocument()
    })
  })

  describe("a stored timezone missing from this browser's list", () => {
    function editable(defaultTimezone: string) {
      useSettingsMock.mockReturnValue({
        data: makeSettings({ defaultTimezone }),
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

    it("doesn't hold up saving another field, and sends the zone unchanged", async () => {
      // The server accepts it (Intl.DateTimeFormat); V8's list omits it.
      const stored = "UTC"
      expect(Intl.supportedValuesOf("timeZone")).not.toContain(stored)
      editable(stored)
      saveSettingsMock.mockResolvedValue(
        makeSettings({ defaultTimezone: stored, rawContentRetentionDays: 7 })
      )
      renderForm("owner")
      await chooseRetention("7 days")
      const bar = screen.getByRole("region", { name: "Save reply policy" })
      expect(bar).not.toHaveTextContent("Fix the marked fields to save.")
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
      await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(1))
      expect(saveSettingsMock.mock.calls[0][0]).toMatchObject({
        rawContentRetentionDays: 7,
        defaultTimezone: stored,
      })
    })

    it("puts the server's refusal of the stored zone on the timezone field", async () => {
      // Sent unchanged (not checked against this browser's list); the
      // server checks it again and its answer lands on the field.
      editable("UTC")
      saveSettingsMock.mockRejectedValue(
        new ApiClientError(
          400,
          "invalid_request",
          "The request did not pass validation.",
          [{ path: ["defaultTimezone"], message: "Use a valid IANA timezone." }]
        )
      )
      renderForm("owner")
      await chooseRetention("7 days")
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
      expect(
        await screen.findByText("Use a valid IANA timezone.")
      ).toBeInTheDocument()
      expect(
        screen.getByRole("combobox", { name: "Default timezone" })
      ).toHaveAttribute("aria-invalid", "true")
    })

    it("marks the timezone field when a changed zone is the problem", async () => {
      // An edit made while the policy was saved as the unlisted "UTC",
      // kept through a reload...
      editable("UTC")
      const first = renderForm("owner")
      await chooseRetention("7 days")
      window.dispatchEvent(new Event("beforeunload", { cancelable: true }))
      first.unmount()
      // ...comes back after someone else saved another zone: restored, the
      // draft's "UTC" is now a change, and this browser doesn't list it.
      editable("Europe/Paris")
      renderForm("owner")
      fireEvent.click(
        screen.getByRole("button", { name: "Restore unsaved edits" })
      )
      expect(
        screen.getByRole("region", { name: "Save reply policy" })
      ).toHaveTextContent("Fix the marked fields to save.")
      expect(screen.getByText("Choose a valid timezone.")).toBeInTheDocument()
      expect(
        screen.getByRole("combobox", { name: "Default timezone" })
      ).toHaveAttribute("aria-invalid", "true")
    })
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

  it("lets an admin save other fields when direct publishing is already on", async () => {
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
    await chooseRetention("7 days")
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
      expect(bar).toHaveTextContent("1 unsaved change · Agency name")
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
      await chooseRetention("7 days")
      expect(
        screen.getByRole("region", { name: "Save reply policy" })
      ).toHaveTextContent("2 unsaved changes · Agency name, Review text")
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
      await waitFor(() => expect(saveSettingsMock).toHaveBeenCalledTimes(1))
      expect(saveSettingsMock.mock.calls[0][0]).toEqual({
        approvalRequired: true,
        requireTwoPersonApproval: false,
        rawContentRetentionDays: 7,
        defaultLanguageCode: "en-GB",
        defaultTimezone: "Europe/London",
        bannedPhrases: [],
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
      const bar = screen.getByRole("region", { name: "Save reply policy" })
      expect(bar).toHaveTextContent("Fix the marked fields to save.")
      // The reason Save is disabled gets its own row on a phone, unclamped.
      expect(
        bar.querySelector('[data-slot="action-bar-status"]')?.className
      ).toMatch(/max-md:basis-full/)
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

  it("warns on a reload while dirty and offers unsaved policy edits back on the next visit", async () => {
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
    const first = renderForm("owner")
    await chooseRetention("7 days")
    const reload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(reload)
    expect(reload.defaultPrevented).toBe(true)
    first.unmount()

    renderForm("owner")
    const retention = retentionSelect()
    expect(retention).toHaveTextContent("14 days")
    fireEvent.click(
      screen.getByRole("button", { name: "Restore unsaved edits" })
    )
    expect(retention).toHaveTextContent("7 days")
    expect(
      screen.getByRole("region", { name: "Save reply policy" })
    ).toHaveTextContent("1 unsaved change")
    expect(
      screen.queryByRole("button", { name: "Restore unsaved edits" })
    ).not.toBeInTheDocument()
  })

  it("offers nothing back to someone who cannot edit the policy", async () => {
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
    const first = renderForm("owner")
    await chooseRetention("7 days")
    first.unmount()
    expect(
      Object.keys(sessionStorage).some((key) => key.startsWith("naba:draft:"))
    ).toBe(true)
    useCapsMock.mockReturnValue({
      data: {
        canManageTeam: false,
        canManageConnections: false,
        canEditSettings: false,
      },
    })
    renderForm("member")
    expect(
      screen.queryByRole("button", { name: "Restore unsaved edits" })
    ).not.toBeInTheDocument()
  })
})
