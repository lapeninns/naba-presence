import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ShareReportButton } from "@/components/clients/share-report-dialog"
import { Toaster } from "@/components/ui/toast"
import * as reportSharesApi from "@/lib/api/report-shares"
import type { ReportShare } from "@/lib/api/report-shares"
import { formatDay } from "@/lib/settings/roles"

const useReportSharesMock = vi.fn()
vi.mock("@/lib/queries/use-report-shares", () => ({
  useReportShares: (...args: unknown[]) => useReportSharesMock(...args),
}))

const CLIENT = "11111111-1111-4111-8111-111111111111"
const NOW = new Date("2026-09-24T12:00:00.000Z")

const share = (overrides: Partial<ReportShare>): ReportShare => ({
  id: "22222222-2222-4222-8222-222222222222",
  status: "active",
  createdAt: "2026-09-01T09:00:00.000Z",
  createdByName: "Priya Owner",
  expiresAt: "2026-11-30T09:00:00.000Z",
  revokedAt: null,
  lastViewedAt: null,
  viewCount: 0,
  ...overrides,
})

const ITEMS: ReportShare[] = [
  share({ viewCount: 3, lastViewedAt: "2026-09-23T12:00:00.000Z" }),
  share({
    id: "33333333-3333-4333-8333-333333333333",
    status: "revoked",
    revokedAt: "2026-09-10T00:00:00.000Z",
  }),
  share({
    id: "44444444-4444-4444-8444-444444444444",
    status: "expired",
    expiresAt: "2026-09-01T00:00:00.000Z",
    createdByName: null,
  }),
]

function renderButton(items: ReportShare[] = ITEMS) {
  useReportSharesMock.mockReturnValue({
    data: { items },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <ShareReportButton clientId={CLIENT} clientName="Old Crown Group" />
      </Toaster>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("Share report dialog", () => {
  it("explains what the link shows, with the expiry date for the default 90 days", async () => {
    const user = userEvent.setup()
    renderButton()
    await user.click(screen.getByRole("button", { name: "Share report" }))
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByRole("heading", {
        name: "Share Old Crown Group’s report",
      })
    ).toBeInTheDocument()
    const ninety = formatDay(
      new Date(NOW.getTime() + 90 * 86_400_000).toISOString()
    )
    expect(
      within(dialog).getByText(
        `Anyone with this link can see Old Crown Group’s review and Google numbers until ${ninety}. No reviews or names are shown.`
      )
    ).toBeInTheDocument()
    expect(within(dialog).getByRole("radio", { name: "90 days" })).toBeChecked()
  })

  it("creates a link for the chosen expiry and shows it once with Copy", async () => {
    const user = userEvent.setup()
    const create = vi
      .spyOn(reportSharesApi, "createReportShare")
      .mockResolvedValue({
        url: "https://app.example.test/share/report/secret-token",
        share: share({ expiresAt: "2026-10-24T12:00:00.000Z" }),
      })
    renderButton()
    await user.click(screen.getByRole("button", { name: "Share report" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("radio", { name: "30 days" }))
    expect(
      within(dialog).getByText(/until 24 Oct 2026\. No reviews or names/)
    ).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole("button", { name: "Create link" })
    )

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(CLIENT, { expiresInDays: 30 })
    )
    const field = await within(dialog).findByRole("textbox", {
      name: "Report link",
    })
    expect(field).toHaveValue(
      "https://app.example.test/share/report/secret-token"
    )
    expect(field).toHaveAttribute("readonly")
    expect(
      within(dialog).getByRole("button", { name: "Copy link" })
    ).toBeInTheDocument()
    expect(within(dialog).getByText(/shown only this once/)).toBeInTheDocument()

    // Closing ends it: reopening starts a fresh link, not the old URL.
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await user.click(screen.getByRole("button", { name: "Share report" }))
    const reopened = await screen.findByRole("dialog")
    expect(
      within(reopened).queryByDisplayValue(/secret-token/)
    ).not.toBeInTheDocument()
    expect(
      within(reopened).getByRole("button", { name: "Create link" })
    ).toBeInTheDocument()
  })

  it("lists existing links with who made them, expiry, views and status", async () => {
    const user = userEvent.setup()
    renderButton()
    await user.click(screen.getByRole("button", { name: "Share report" }))
    const dialog = await screen.findByRole("dialog")
    const list = within(dialog).getAllByRole("listitem")
    expect(list).toHaveLength(3)
    expect(within(list[0]).getByText("Active")).toBeInTheDocument()
    expect(
      within(list[0]).getByText(/Created by Priya Owner 1 Sept? 2026/)
    ).toBeInTheDocument()
    expect(within(list[0]).getByText(/3 views, last/)).toBeInTheDocument()
    expect(within(list[1]).getByText("Revoked")).toBeInTheDocument()
    expect(within(list[2]).getByText("Expired")).toBeInTheDocument()
    expect(
      within(list[2]).getByText(/Created by a former teammate/)
    ).toBeInTheDocument()
    // Only a live link can be revoked.
    expect(
      within(dialog).getAllByRole("button", { name: /^Revoke the link/ })
    ).toHaveLength(1)
  })

  it("revokes a link only after confirming", async () => {
    const user = userEvent.setup()
    const revoke = vi
      .spyOn(reportSharesApi, "revokeReportShare")
      .mockResolvedValue({ revoked: true })
    renderButton()
    await user.click(screen.getByRole("button", { name: "Share report" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(
      within(dialog).getByRole("button", { name: /^Revoke the link/ })
    )
    const confirm = await screen.findByRole("alertdialog")
    expect(
      within(confirm).getByRole("heading", { name: "Revoke this link?" })
    ).toBeInTheDocument()
    expect(revoke).not.toHaveBeenCalled()
    await user.click(
      within(confirm).getByRole("button", { name: "Revoke link" })
    )
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith(
        CLIENT,
        "22222222-2222-4222-8222-222222222222"
      )
    )
  })

  it("keeps the choice and says why when creating fails", async () => {
    const user = userEvent.setup()
    vi.spyOn(reportSharesApi, "createReportShare").mockRejectedValue(
      new Error("Network down")
    )
    renderButton([])
    await user.click(screen.getByRole("button", { name: "Share report" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/No links yet/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole("radio", { name: "1 year" }))
    await user.click(
      within(dialog).getByRole("button", { name: "Create link" })
    )
    expect(
      await within(dialog).findByText("The link wasn’t created")
    ).toBeInTheDocument()
    expect(within(dialog).getByRole("radio", { name: "1 year" })).toBeChecked()
  })
})
