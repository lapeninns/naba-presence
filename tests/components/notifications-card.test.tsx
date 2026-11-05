import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NotificationsCard } from "@/components/settings/notifications-card"
import { Toaster } from "@/components/ui/toast"

const workspaceMock = vi.fn()
const accountsMock = vi.fn()
const settingMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({
  useConnectionWorkspace: () => workspaceMock(),
}))
vi.mock("@/lib/queries/use-google-accounts", () => ({
  useGoogleAccounts: () => accountsMock(),
}))
vi.mock("@/lib/queries/use-notification-setting", () => ({
  useNotificationSetting: () => settingMock(),
}))

type Account = {
  id: string
  googleAccountName: string
  accountName?: string
  isActive: boolean
}

function renderCard(
  pubsubTopic: string | null = "projects/p/topics/reviews",
  accounts: Account[] = [
    { id: "a1", googleAccountName: "accounts/1", isActive: true },
  ],
  notificationTypes: string[] = ["NEW_REVIEW"]
) {
  workspaceMock.mockReturnValue({
    query: { data: { connections: [{ id: "c1", status: "active" }] } },
  })
  accountsMock.mockReturnValue({
    query: {
      data: { accounts },
    },
  })
  settingMock.mockReturnValue({
    query: {
      data: {
        setting: {
          name: "accounts/1/notificationSetting",
          pubsubTopic,
          notificationTypes,
        },
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    },
    save: { mutate: vi.fn(), isPending: false },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <NotificationsCard />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("NotificationsCard", () => {
  it("shows the pub/sub topic and humanised notification types", () => {
    renderCard()
    expect(screen.getByRole("textbox", { name: "Pub/Sub topic" })).toHaveValue(
      "projects/p/topics/reviews"
    )
    expect(
      screen.getByRole("switch", { name: "New reviews" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Save notifications" })
    ).toBeInTheDocument()
  })

  it("reads as on/off first and keeps the topic under Advanced", () => {
    const { container } = renderCard(null)
    expect(
      screen.getByText("Off. Reviews arrive on the scheduled check.")
    ).toBeInTheDocument()
    const details = container.querySelector("details")
    expect(details).not.toHaveAttribute("open")
    expect(details).toHaveTextContent("Advanced: Google Cloud Pub/Sub topic")
  })

  it("says new reviews still wait for the scheduled check when Google is not sending them", () => {
    renderCard("projects/p/topics/reviews", undefined, ["UPDATED_REVIEW"])
    expect(
      screen.getByText(
        "On, but not for new reviews. They arrive on the scheduled check."
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText("On. Google sends new reviews as they happen.")
    ).not.toBeInTheDocument()
  })

  it("opens Advanced when a topic is already set", () => {
    const { container } = renderCard()
    expect(container.querySelector("details")).toHaveAttribute("open")
    expect(
      screen.getByText("On. Google sends new reviews as they happen.")
    ).toBeInTheDocument()
  })

  // An agency login usually reaches several Business Profile accounts. The
  // card used to auto-pick only when there was exactly one, and had no
  // picker, so with two it said "Choose a Google account" for ever.
  it("offers an account picker when the login reaches several accounts", async () => {
    const user = userEvent.setup()
    const view = renderCard(null, [
      {
        id: "a1",
        googleAccountName: "accounts/1",
        accountName: "Riverside group",
        isActive: true,
      },
      {
        id: "a2",
        googleAccountName: "accounts/2",
        accountName: "Harbour group",
        isActive: true,
      },
    ])
    expect(
      view.getByText("Choose a Business Profile account")
    ).toBeInTheDocument()
    const picker = view.getByRole("combobox", {
      name: "Business Profile account",
    })
    await user.click(picker)
    await user.click(
      await screen.findByRole("option", { name: "Harbour group" })
    )
    expect(
      await view.findByRole("button", { name: "Save notifications" })
    ).toBeInTheDocument()
  })

  it("saves with the send button, since the setting is written to Google", () => {
    renderCard()
    expect(
      screen.getByRole("button", { name: "Save notifications" })
    ).toHaveAttribute("data-variant", "send")
  })

  it("says a failed read changed nothing on Google, with a retry", async () => {
    const user = userEvent.setup()
    renderCard()
    const refetch = vi.fn()
    settingMock.mockReturnValue({
      query: {
        data: undefined,
        isPending: false,
        isError: true,
        error: new Error("boom"),
        refetch,
      },
      save: { mutate: vi.fn(), isPending: false },
    })
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <Toaster>
          <NotificationsCard />
        </Toaster>
      </QueryClientProvider>
    )
    const regions = screen.getAllByRole("region", {
      name: "Real-time notifications",
    })
    const failed = regions[regions.length - 1]
    expect(failed).toHaveTextContent("We couldn’t load notifications")
    expect(failed).toHaveTextContent("Nothing was changed on Google.")
    await user.click(within(failed).getByRole("button", { name: /try again/i }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
