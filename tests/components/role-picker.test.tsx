import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { RolePicker } from "@/components/settings/member-dialogs"
import type { MemberRole } from "@/lib/settings/forms/invitation"
import { queryKeys } from "@/lib/queries/keys"
import { roleDescriptions, roleSummaries } from "@/lib/settings/roles"

function Harness({
  actorRole,
  initial = "member",
  onValueChange,
  mode = "agency",
}: {
  actorRole: MemberRole
  initial?: MemberRole
  onValueChange?: (role: MemberRole) => void
  mode?: "agency" | "business"
}) {
  const [client] = useState(() => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(queryKeys.session, {
      session: { workspaceMode: mode },
    })
    return queryClient
  })
  const [value, setValue] = useState<MemberRole>(initial)
  return (
    <QueryClientProvider client={client}>
      <span id="role-label">Role</span>
      <RolePicker
        actorRole={actorRole}
        value={value}
        labelledBy="role-label"
        onValueChange={(role) => {
          setValue(role)
          onValueChange?.(role)
        }}
      />
    </QueryClientProvider>
  )
}

describe("RolePicker", () => {
  it("lists the roles as compact radio rows: Member, Viewer, Admin, Owner", () => {
    render(<Harness actorRole="owner" />)
    const group = screen.getByRole("radiogroup", { name: "Role" })
    const rows = within(group).getAllByRole("radio")
    expect(rows.map((row) => row.getAttribute("data-slot"))).toEqual(
      Array(4).fill("option-row")
    )
    expect(
      rows.map(
        (row) => row.textContent?.match(/^(Member|Viewer|Admin|Owner)/)?.[0]
      )
    ).toEqual(["Member", "Viewer", "Admin", "Owner"])
  })

  it("leaves Owner out for an admin", () => {
    render(<Harness actorRole="admin" />)
    const rows = screen.getAllByRole("radio")
    expect(rows).toHaveLength(3)
    expect(screen.queryByRole("radio", { name: /^Owner/ })).toBeNull()
  })

  it("marks Member as the usual choice, and only Member", () => {
    render(<Harness actorRole="owner" />)
    expect(screen.getAllByText("Usual choice")).toHaveLength(1)
    expect(screen.getByRole("radio", { name: /^Member/ })).toHaveTextContent(
      "Usual choice"
    )
  })

  it("shows the one-line summary on each row and the full description on the selected one", () => {
    render(<Harness actorRole="owner" />)
    const summaries = roleSummaries("agency")
    const full = roleDescriptions("agency")
    const member = screen.getByRole("radio", { name: /^Member/ })
    expect(member).toBeChecked()
    expect(member).toHaveAccessibleDescription(full.member)
    expect(
      screen.getByRole("radio", { name: /^Viewer/ })
    ).toHaveAccessibleDescription(summaries.viewer)
    expect(
      screen.getByRole("radio", { name: /^Admin/ })
    ).toHaveAccessibleDescription(summaries.admin)
    // Member's full copy no longer promises listing edits.
    expect(full.member).not.toMatch(/\bedits\b/i)
  })

  it("moves the full description to the row that is chosen, and reports the choice", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Harness actorRole="owner" onValueChange={onValueChange} />)
    await user.click(screen.getByRole("radio", { name: /^Viewer/ }))
    expect(onValueChange).toHaveBeenCalledWith("viewer")
    expect(screen.getByRole("radio", { name: /^Viewer/ })).toBeChecked()
    expect(screen.getByRole("radio", { name: /^Member/ })).not.toBeChecked()
    expect(
      screen.getByRole("radio", { name: /^Viewer/ })
    ).toHaveAccessibleDescription(roleDescriptions("agency").viewer)
    expect(
      screen.getByRole("radio", { name: /^Member/ })
    ).toHaveAccessibleDescription(roleSummaries("agency").member)
  })

  it("moves with the arrow keys, choosing as it goes", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<Harness actorRole="owner" onValueChange={onValueChange} />)
    screen.getByRole("radio", { name: /^Member/ }).focus()
    await user.keyboard("{ArrowDown}")
    expect(onValueChange).toHaveBeenLastCalledWith("viewer")
    await user.keyboard("{ArrowDown}")
    expect(onValueChange).toHaveBeenLastCalledWith("admin")
  })

  it("says locations, not clients, in a business workspace", () => {
    render(<Harness actorRole="owner" mode="business" initial="admin" />)
    const admin = screen.getByRole("radio", { name: /^Admin/ })
    expect(admin).toHaveAccessibleDescription(
      roleDescriptions("business").admin
    )
    expect(admin).toHaveAccessibleDescription(/location/)
    expect(admin).not.toHaveAccessibleDescription(/client/)
  })
})
