import { render, screen, within } from "@testing-library/react"
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
const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
// The page's own sections are not under test here, only the chrome it
// registers, the dialog both triggers open and what it hands the members
// table.
type MembersTableProps = {
  onSelfRoleChanged?: () => void
  removedFocus?: { current: HTMLElement | null }
}
const inviteFinalFocus: {
  current: { current: HTMLElement | null } | undefined
} = { current: undefined }
const membersTableProps: { current: MembersTableProps | null } = {
  current: null,
}
vi.mock("@/components/settings/members-table", () => ({
  MembersTable: (props: MembersTableProps) => {
    membersTableProps.current = props
    return null
  },
}))
vi.mock("@/components/settings/invitations-panel", () => ({
  InvitationsList: () => null,
  InviteDialog: ({
    open,
    finalFocus,
  }: {
    open: boolean
    finalFocus?: { current: HTMLElement | null }
  }) => {
    inviteFinalFocus.current = finalFocus
    return (
      <output data-testid="invite-dialog">{open ? "open" : "closed"}</output>
    )
  },
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

describe("TeamView members section", () => {
  it("re-renders the page from the server after your own role changed", () => {
    renderPage()
    expect(refresh).not.toHaveBeenCalled()
    membersTableProps.current?.onSelfRoleChanged?.()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("hands the table the Members heading to focus after a removal", () => {
    renderPage()
    const target = membersTableProps.current?.removedFocus?.current
    expect(target).toBeInstanceOf(HTMLElement)
    expect(target).toHaveTextContent("Members")
    expect(target).toHaveAttribute("tabindex", "-1")
    expect(
      screen.getByRole("heading", { level: 2, name: "Members" })
    ).toContainElement(target!)
    target!.focus()
    expect(target).toHaveFocus()
  })
})

describe("TeamView roles card", () => {
  it("draws a role's yes in ink, not the green kept for changes live on Google", () => {
    renderPage()
    const table = screen.getByRole("table", { name: "What each role can do" })
    expect(table.querySelectorAll(".text-success-ink")).toHaveLength(0)
    expect(within(table).getAllByText("Yes").length).toBeGreaterThan(0)
  })
})

describe("TeamView invite from the address", () => {
  afterEach(() => window.history.replaceState(null, "", "/"))

  it("hands focus to the header's invite when #invite opened it", () => {
    window.history.replaceState(null, "", "/team#invite")
    renderPage()
    expect(screen.getByTestId("invite-dialog")).toHaveTextContent("open")
    expect(inviteFinalFocus.current?.current).toBe(
      screen.getByRole("button", { name: "Invite a teammate" })
    )
  })

  it("leaves focus to the opener when a button opened it", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole("button", { name: "Invite a teammate" }))
    expect(screen.getByTestId("invite-dialog")).toHaveTextContent("open")
    expect(inviteFinalFocus.current).toBeUndefined()
  })
})
