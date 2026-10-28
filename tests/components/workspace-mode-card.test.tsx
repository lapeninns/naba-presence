import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const hardNavigate = vi.fn()
vi.mock("@/lib/client/hard-navigate", () => ({
  hardNavigate: (path: string) => hardNavigate(path),
}))

import { WorkspaceModeCard } from "@/components/settings/workspace-mode-card"
import { ApiClientError } from "@/lib/api/client"
import * as sessionApi from "@/lib/api/session"
import { queryKeys } from "@/lib/queries/keys"

function renderCard(
  workspaceMode: "business" | "agency",
  role: "owner" | "admin" = "owner",
  props: { billingEnabled?: boolean } = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(queryKeys.session, {
    session: {
      userId: "u1",
      organisationId: "o1",
      organisationName: "The Bell",
      workspaceMode,
      displayName: "Aman",
      email: "aman@example.test",
      role,
      canPublish: true,
    },
  })
  return render(
    <QueryClientProvider client={client}>
      <WorkspaceModeCard {...props} />
    </QueryClientProvider>
  )
}

const RESULT_KEY = "naba:workspace-mode-result"

/** Opens the dialog and presses its confirm button. */
async function confirmSwitch(
  user: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await user.click(screen.getByRole("button", { name }))
  const dialog = await screen.findByRole("alertdialog")
  await user.click(
    screen
      .getAllByRole("button", { name })
      .find((button) => dialog.contains(button))!
  )
  return dialog
}

afterEach(() => {
  vi.restoreAllMocks()
  hardNavigate.mockReset()
  sessionStorage.clear()
})

describe("WorkspaceModeCard", () => {
  it("renders nothing for anyone but an owner", () => {
    const { container } = renderCard("business", "admin")
    expect(container).toBeEmptyDOMElement()
  })

  it("switches a business to an agency after confirmation and reloads Settings", async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(sessionApi, "changeWorkspaceMode").mockResolvedValue({
      organisation: { organisationId: "o1", workspaceMode: "agency" },
      changed: true,
      refiledLocations: 0,
    })
    renderCard("business")
    expect(
      screen.getByText(
        "This is a business workspace: all your locations sit together under your business."
      )
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Switch to an agency workspace" })
    )
    const dialog = await screen.findByRole("alertdialog", {
      name: "Switch to an agency workspace?",
    })
    expect(spy).not.toHaveBeenCalled()
    await user.click(
      (
        await screen.findAllByRole("button", {
          name: "Switch to an agency workspace",
        })
      ).find((button) => dialog.contains(button))!
    )
    await waitFor(() => expect(spy).toHaveBeenCalledWith("agency"))
    await waitFor(() =>
      expect(hardNavigate).toHaveBeenCalledWith(
        "/settings/policy#settings-workspace-type"
      )
    )
  })

  it("explains a refused switch to business and stays put", async () => {
    const user = userEvent.setup()
    vi.spyOn(sessionApi, "changeWorkspaceMode").mockRejectedValue(
      new ApiClientError(
        409,
        "workspace_mode_too_many_clients",
        "This agency has 2 active clients."
      )
    )
    renderCard("agency")
    await user.click(
      screen.getByRole("button", { name: "Switch to a business workspace" })
    )
    const dialog = await screen.findByRole("alertdialog")
    await user.click(
      screen
        .getAllByRole("button", { name: "Switch to a business workspace" })
        .find((button) => dialog.contains(button))!
    )
    expect(
      await screen.findByText(
        "A business workspace holds one client. Archive the others on the Clients page, then switch."
      )
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open Clients" })).toHaveAttribute(
      "href",
      "/clients"
    )
    expect(
      screen.queryByRole("link", { name: "Open Billing" })
    ).not.toBeInTheDocument()
    expect(hardNavigate).not.toHaveBeenCalled()
  })

  it.each([
    [true, true],
    [false, false],
  ])(
    "links a billing refusal to Billing only while billing is on (billingEnabled %s)",
    async (billingEnabled, linked) => {
      const user = userEvent.setup()
      vi.spyOn(sessionApi, "changeWorkspaceMode").mockRejectedValue(
        new ApiClientError(409, "billing_subscription_active", "Refused.")
      )
      renderCard("agency", "owner", { billingEnabled })
      await confirmSwitch(user, "Switch to a business workspace")
      await screen.findByText(/Cancel it from Billing/)
      const link = screen.queryByRole("link", { name: "Open Billing" })
      if (linked) expect(link).toHaveAttribute("href", "/settings/billing")
      else expect(link).not.toBeInTheDocument()
      expect(
        screen.queryByRole("link", { name: "Open Clients" })
      ).not.toBeInTheDocument()
    }
  )

  it("asks for two-step verification without blaming permissions", async () => {
    const user = userEvent.setup()
    vi.spyOn(sessionApi, "changeWorkspaceMode").mockRejectedValue(
      new ApiClientError(403, "mfa_step_up_required", "Verify.")
    )
    renderCard("agency")
    await confirmSwitch(user, "Switch to a business workspace")
    expect(
      await screen.findByText(
        "Confirm it’s you in the window that opened, then switch again. Nothing was changed."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/permission/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    // Starting again clears the note.
    await user.click(
      screen.getByRole("button", { name: "Switch to a business workspace" })
    )
    expect(
      screen.queryByText(
        "Confirm it’s you in the window that opened, then switch again. Nothing was changed."
      )
    ).not.toBeInTheDocument()
  })

  it("asks an owner without two-step verification to set it up first", async () => {
    const user = userEvent.setup()
    vi.spyOn(sessionApi, "changeWorkspaceMode").mockRejectedValue(
      new ApiClientError(403, "mfa_enrollment_required", "Enrol.")
    )
    renderCard("agency")
    await confirmSwitch(user, "Switch to a business workspace")
    expect(
      await screen.findByText(
        "Set up two-step verification in the window that opened, then switch again. Nothing was changed."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/Confirm it’s you/)).not.toBeInTheDocument()
  })

  it("leads the switch-to-business dialog with its condition", async () => {
    const user = userEvent.setup()
    renderCard("agency")
    await user.click(
      screen.getByRole("button", { name: "Switch to a business workspace" })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveAccessibleDescription(
      /^This needs one active client or none\./
    )
  })

  it("keeps the dialog's cancel disabled while the switch is on its way", async () => {
    const user = userEvent.setup()
    vi.spyOn(sessionApi, "changeWorkspaceMode").mockReturnValue(
      new Promise(() => {})
    )
    renderCard("business")
    const dialog = await confirmSwitch(user, "Switch to an agency workspace")
    const cancel = await screen.findByRole("button", {
      name: "Keep it as it is",
    })
    expect(dialog.contains(cancel)).toBe(true)
    await waitFor(() => expect(cancel).toBeDisabled())
  })

  it("keeps the server's answer for after the reload, and says it once", async () => {
    const user = userEvent.setup()
    vi.spyOn(sessionApi, "changeWorkspaceMode").mockResolvedValue({
      organisation: { organisationId: "o1", workspaceMode: "business" },
      changed: true,
      refiledLocations: 2,
    })
    const first = renderCard("agency")
    await confirmSwitch(user, "Switch to a business workspace")
    await waitFor(() => expect(hardNavigate).toHaveBeenCalled())
    // Nothing is said before the reload; the answer is kept for it.
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem(RESULT_KEY)!)).toEqual({
      workspaceMode: "business",
      changed: true,
      refiledLocations: 2,
    })
    first.unmount()

    // The reloaded page, now in business mode.
    const second = renderCard("business")
    expect(
      await screen.findByText(
        "Switched. This is now a business workspace. 2 locations were filed under your business."
      )
    ).toBeInTheDocument()
    expect(sessionStorage.getItem(RESULT_KEY)).toBeNull()
    second.unmount()

    renderCard("business")
    expect(screen.queryByText(/^Switched\./)).not.toBeInTheDocument()
  })

  it.each([
    [
      { workspaceMode: "agency", changed: true, refiledLocations: 0 },
      "Switched. This is now an agency workspace. You can add clients from Clients.",
    ],
    [
      { workspaceMode: "business", changed: true, refiledLocations: 0 },
      "Switched. This is now a business workspace.",
    ],
    [
      { workspaceMode: "agency", changed: false, refiledLocations: 0 },
      "This was already an agency workspace. Nothing changed.",
    ],
  ])("says what a stored result %j means", async (stored, message) => {
    sessionStorage.setItem(RESULT_KEY, JSON.stringify(stored))
    renderCard(stored.workspaceMode as "business" | "agency")
    expect(await screen.findByRole("status")).toHaveTextContent(message)
  })

  it("ignores a malformed stored result", () => {
    sessionStorage.setItem(RESULT_KEY, "{not json")
    renderCard("agency")
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(sessionStorage.getItem(RESULT_KEY)).toBeNull()
  })

  it("asks again with the counts when live report shares would widen, then confirms", async () => {
    const user = userEvent.setup()
    const spy = vi
      .spyOn(sessionApi, "changeWorkspaceMode")
      .mockRejectedValueOnce(
        new ApiClientError(409, "workspace_mode_report_shares", "Refused.", {
          locationsToRefile: 2,
          activeReportShares: 1,
        })
      )
      .mockResolvedValueOnce({
        organisation: { organisationId: "o1", workspaceMode: "business" },
        changed: true,
        refiledLocations: 2,
      })
    renderCard("agency")
    await user.click(
      screen.getByRole("button", { name: "Switch to a business workspace" })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent(/archived client/)
    expect(dialog).toHaveTextContent(/Report share links/)
    await user.click(
      screen
        .getAllByRole("button", { name: "Switch to a business workspace" })
        .find((button) => dialog.contains(button))!
    )
    expect(
      await screen.findByText(
        /2 locations will be filed under a client with 1 live report share link\./
      )
    ).toBeInTheDocument()
    // Pointed at where links are revoked, with the way there.
    expect(dialog).toHaveTextContent(
      "If that is not what you want, revoke the links from the client’s Share report first."
    )
    expect(dialog).not.toHaveTextContent(/in Reports/)
    expect(
      within(dialog).getByRole("link", { name: "Open Clients" })
    ).toHaveAttribute("href", "/clients")
    expect(hardNavigate).not.toHaveBeenCalled()
    expect(spy).toHaveBeenLastCalledWith("business")
    await user.click(
      screen.getByRole("button", { name: "Switch and share them" })
    )
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith("business", {
        confirmReportShares: true,
      })
    )
    await waitFor(() =>
      expect(hardNavigate).toHaveBeenCalledWith(
        "/settings/policy#settings-workspace-type"
      )
    )
  })

  it("renders nothing until the session has loaded", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, enabled: false } },
    })
    const { container } = render(
      <QueryClientProvider client={client}>
        <WorkspaceModeCard />
      </QueryClientProvider>
    )
    expect(container).toBeEmptyDOMElement()
  })
})
