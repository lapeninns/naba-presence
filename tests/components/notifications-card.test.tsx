import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
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

function renderCard(pubsubTopic: string | null = "projects/p/topics/reviews") {
  workspaceMock.mockReturnValue({
    query: { data: { connections: [{ id: "c1", status: "active" }] } },
  })
  accountsMock.mockReturnValue({
    query: {
      data: {
        accounts: [
          { id: "a1", googleAccountName: "accounts/1", isActive: true },
        ],
      },
    },
  })
  settingMock.mockReturnValue({
    query: {
      data: {
        setting: {
          name: "accounts/1/notificationSetting",
          pubsubTopic,
          notificationTypes: ["NEW_REVIEW"],
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

  it("opens Advanced when a topic is already set", () => {
    const { container } = renderCard()
    expect(container.querySelector("details")).toHaveAttribute("open")
    expect(
      screen.getByText("On. Google sends new reviews as they happen.")
    ).toBeInTheDocument()
  })
})
