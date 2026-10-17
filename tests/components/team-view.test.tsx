import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  PageChromeProvider,
  usePageChromeOverride,
} from "@/components/app-shell/page-chrome"
import { TeamView } from "@/components/settings/team-view"

vi.mock("@/lib/queries/use-members", () => ({
  useMembers: () => ({ data: undefined }),
}))
vi.mock("@/lib/workspace/mode", () => ({
  useWorkspaceMode: () => "agency",
}))
// The page's own sections are not under test here, only the chrome it
// registers and the dialog both triggers open.
vi.mock("@/components/settings/members-table", () => ({
  MembersTable: () => null,
}))
vi.mock("@/components/settings/invitations-panel", () => ({
  InvitationsList: () => null,
  InviteDialog: ({ open }: { open: boolean }) => (
    <output data-testid="invite-dialog">{open ? "open" : "closed"}</output>
  ),
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
          ? `${action.label}|${action.icon ? "icon" : "no icon"}|${action.href ?? "no href"}`
          : "none"}
      </output>
    </>
  )
}

function renderPage() {
  return render(
    <PageChromeProvider>
      <Probe />
      <TeamView actorRole="owner" actorUserId="u1" />
    </PageChromeProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("TeamView chrome (SET-25)", () => {
  it("registers the header's invite as the app-bar action, in the same words", async () => {
    renderPage()
    expect(await screen.findByTestId("action")).toHaveTextContent(
      "Invite a teammate|icon|no href"
    )
    expect(
      screen.getByRole("button", { name: "Invite a teammate" })
    ).toBeInTheDocument()
  })

  it("opens the same invite dialog as the header button", async () => {
    renderPage()
    await screen.findByTestId("action")
    expect(screen.getByTestId("invite-dialog")).toHaveTextContent("closed")
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Run registered action" }))
    expect(screen.getByTestId("invite-dialog")).toHaveTextContent("open")
  })

  it("drops the action when the page unmounts", async () => {
    const view = render(
      <PageChromeProvider>
        <Probe />
        <TeamView actorRole="admin" actorUserId="u1" />
      </PageChromeProvider>
    )
    expect(await screen.findByTestId("action")).toHaveTextContent(
      "Invite a teammate"
    )
    view.rerender(
      <PageChromeProvider>
        <Probe />
      </PageChromeProvider>
    )
    expect(screen.getByTestId("action")).toHaveTextContent("none")
  })
})
