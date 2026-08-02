import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NotificationsCard } from "@/components/settings/notifications-card"
import { Toaster } from "@/components/ui/toast"

const workspaceMock = vi.fn()
const accountsMock = vi.fn()
const settingMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({ useConnectionWorkspace: () => workspaceMock() }))
vi.mock("@/lib/queries/use-google-accounts", () => ({ useGoogleAccounts: () => accountsMock() }))
vi.mock("@/lib/queries/use-notification-setting", () => ({ useNotificationSetting: () => settingMock() }))

function renderCard() {
  workspaceMock.mockReturnValue({ query: { data: { connections: [{ id: "c1", status: "active" }] } } })
  accountsMock.mockReturnValue({ query: { data: { accounts: [{ id: "a1", googleAccountName: "accounts/1", isActive: true }] } } })
  settingMock.mockReturnValue({
    query: { data: { setting: { name: "accounts/1/notificationSetting", pubsubTopic: "projects/p/topics/reviews", notificationTypes: ["NEW_REVIEW"] } }, isPending: false, isError: false, refetch: vi.fn() },
    save: { mutate: vi.fn(), isPending: false },
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
    expect(screen.getByRole("textbox", { name: "Pub/Sub topic" })).toHaveValue("projects/p/topics/reviews")
    expect(screen.getByRole("checkbox", { name: "New reviews" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save notifications" })).toBeInTheDocument()
  })
})
