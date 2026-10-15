import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  PageChromeProvider,
  usePageChromeOverride,
} from "@/components/app-shell/page-chrome"
import { ConnectionsWorkspace } from "@/components/settings/connections-workspace"

const workspaceMock = vi.fn()
vi.mock("@/lib/queries/use-connection-workspace", () => ({
  useConnectionWorkspace: () => workspaceMock(),
}))
vi.mock("@/lib/queries/use-clients", () => ({
  useClients: () => ({ data: { items: [] } }),
}))
vi.mock("@/lib/workspace/mode", () => ({
  useWorkspaceMode: () => "agency",
}))
// The page's own sections are not under test here, only the chrome it
// registers.
vi.mock("@/components/settings/connection-card", () => ({
  ConnectionCard: () => null,
}))
vi.mock("@/components/settings/notifications-card", () => ({
  NotificationsCard: () => null,
}))
vi.mock("@/components/settings/oauth-return", () => ({
  OAuthReturn: () => null,
}))
vi.mock("@/components/settings/reconnect-alert", () => ({
  ReconnectAlert: () => null,
}))
vi.mock("@/components/settings/settings-nav", () => ({
  SettingsNav: () => null,
}))

function Probe() {
  const { action } = usePageChromeOverride()
  return (
    <>
      <button type="button" onClick={action?.onSelect}>
        Run registered action
      </button>
      <output data-testid="action">
        {action
          ? `${action.label}|${action.pending ? "pending" : "idle"}|${action.pendingLabel}`
          : "none"}
      </output>
    </>
  )
}

function renderPage(count: number, mutate = vi.fn(), isPending = false) {
  workspaceMock.mockReturnValue({
    query: {
      data: {
        connections: Array.from({ length: count }, (_, index) => ({
          id: `c${index}`,
        })),
      },
    },
    connect: { mutate, isPending },
  })
  return render(
    <PageChromeProvider>
      <Probe />
      <ConnectionsWorkspace role="owner" />
    </PageChromeProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("ConnectionsWorkspace chrome", () => {
  it("registers the app-bar action, with the header button's words, once an account exists", async () => {
    renderPage(1)
    expect(await screen.findByTestId("action")).toHaveTextContent(
      "Connect another account|idle|Opening Google…"
    )
    expect(
      screen.getByRole("button", { name: "Connect another account" })
    ).toBeInTheDocument()
  })

  it("registers none, and shows no header button, when no account is connected", () => {
    renderPage(0)
    expect(screen.getByTestId("action")).toHaveTextContent("none")
    expect(
      screen.queryByRole("button", { name: "Connect another account" })
    ).toBeNull()
  })

  it("passes the pending state through", async () => {
    renderPage(1, vi.fn(), true)
    expect(await screen.findByTestId("action")).toHaveTextContent(
      "Connect another account|pending|Opening Google…"
    )
  })

  it("starts the same connect call as the header button", async () => {
    const mutate = vi.fn()
    renderPage(1, mutate)
    await screen.findByTestId("action")
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Run registered action" }))
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith({})
  })
})
