import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
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
  role: "owner" | "admin" = "owner"
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
      <WorkspaceModeCard />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  hardNavigate.mockReset()
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
    expect(screen.getByText(/This is a business workspace/)).toBeInTheDocument()
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
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith("/settings"))
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
    expect(hardNavigate).not.toHaveBeenCalled()
  })

  it("asks again with the counts when live report shares would widen, then confirms", async () => {
    const user = userEvent.setup()
    const spy = vi
      .spyOn(sessionApi, "changeWorkspaceMode")
      .mockRejectedValueOnce(
        new ApiClientError(
          409,
          "workspace_mode_report_shares",
          "Refused.",
          { locationsToRefile: 2, activeReportShares: 1 }
        )
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
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith("/settings"))
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
