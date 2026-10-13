import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const followed = vi.hoisted(() => vi.fn())
const hardNavigate = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  usePathname: () => "/listings/l1/hours",
}))
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...props }: ComponentProps<"a">) => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event)
        followed(href)
        event.preventDefault()
      }}
    >
      {children}
    </a>
  ),
}))
vi.mock("@/lib/client/hard-navigate", () => ({ hardNavigate }))
vi.mock("@/lib/queries/use-locations", () => ({
  useLocationDirectory: () => ({
    data: [
      { id: "l1", name: "Old Crown Girton", clientId: "c1", linked: true },
      { id: "l2", name: "Old Crown Cambridge", clientId: "c1", linked: true },
      { id: "x9", name: "Another client's pub", clientId: "c2", linked: true },
    ],
  }),
}))

import { SiblingSwitcher } from "@/components/listings/sibling-switcher"
import { useLeaveGuard } from "@/lib/editors/use-leave-guard"
import type { DirectoryEntry } from "@/lib/queries/use-locations"

const current = {
  id: "l1",
  name: "Old Crown Girton",
  clientId: "c1",
  clientName: "Old Crown",
  linked: true,
} as DirectoryEntry

function Harness({ dirty = false }: { dirty?: boolean }) {
  const leave = useLeaveGuard({ when: dirty })
  return (
    <>
      <SiblingSwitcher current={current} role="owner" />
      {leave.open ? (
        <div role="dialog" aria-label="Leave without saving?">
          <button onClick={leave.onConfirm}>Leave and discard</button>
        </div>
      ) : null}
    </>
  )
}

afterEach(() => vi.clearAllMocks())

describe("SiblingSwitcher", () => {
  it("lists only this client's listings as links that keep the open area", async () => {
    render(<Harness />)
    expect(screen.queryByRole("combobox")).toBeNull()
    await userEvent.click(
      screen.getByRole("button", {
        name: /Old Crown Girton.*switch to another listing of this client/,
      })
    )
    expect(
      await screen.findByRole("menuitem", { name: "Old Crown Cambridge" })
    ).toHaveAttribute("href", "/listings/l2/hours")
    // The current listing's row opens its overview.
    expect(
      screen.getByRole("menuitem", { name: "Old Crown Girton" })
    ).toHaveAttribute("href", "/listings/l1")
    expect(
      screen.queryByRole("menuitem", { name: "Another client's pub" })
    ).toBeNull()
  })

  it("navigates client-side through the leave guard, never by a full reload", async () => {
    render(<Harness dirty />)
    await userEvent.click(
      screen.getByRole("button", { name: /switch to another listing/ })
    )
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Old Crown Cambridge" })
    )
    expect(followed).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Leave and discard" }))
    expect(followed).toHaveBeenCalledExactlyOnceWith("/listings/l2/hours")
    expect(hardNavigate).not.toHaveBeenCalled()
  })

  it("renders the plain fallback when the client has one listing", () => {
    render(
      <SiblingSwitcher
        current={{ ...current, clientId: "c3" }}
        role="owner"
        fallback={<span role="link">Old Crown Girton</span>}
      />
    )
    expect(screen.queryByRole("button")).toBeNull()
    expect(
      screen.getByRole("link", { name: "Old Crown Girton" })
    ).toBeInTheDocument()
  })
})
