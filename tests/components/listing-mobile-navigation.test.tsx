import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const followed = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  usePathname: () => "/listings/l1/profile",
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
vi.mock("@/lib/queries/use-locations", () => ({
  useLocationDirectory: () => ({ data: [] }),
}))

import { ListingAreaHeader } from "@/components/listings/area-frame"
import { useLeaveGuard } from "@/lib/editors/use-leave-guard"
import type { DirectoryEntry } from "@/lib/queries/use-locations"

const entry = {
  id: "l1",
  name: "The very long venue name that should wrap without hiding navigation",
  linked: true,
} as DirectoryEntry
function Header({
  role = "owner",
  current = "profile",
  dirty = false,
  publishBlocked = false,
}: {
  role?: string
  current?: "profile" | "hours"
  dirty?: boolean
  publishBlocked?: boolean
}) {
  const leave = useLeaveGuard({ when: dirty })
  return (
    <>
      <ListingAreaHeader
        entry={entry}
        role={role}
        locationId="l1"
        current={current}
        summary={undefined}
        caps={{
          canEditCanonical: true,
          canPublish: true,
          resources: {
            ...(publishBlocked
              ? {
                  hours: {
                    state: "blocked" as const,
                    reasonCode: "publish_not_allowed",
                  },
                }
              : {}),
            menu: {
              state: "unavailable",
              reasonCode: "google_location_not_linked",
            },
          },
        }}
        status={null}
      />
      {leave.open ? (
        <div role="dialog" aria-label="Leave without saving?">
          <button onClick={() => leave.onOpenChange(false)}>
            Keep editing
          </button>
          <button onClick={leave.onConfirm}>Leave and discard</button>
        </div>
      ) : null}
    </>
  )
}
afterEach(() => vi.clearAllMocks())

describe("mobile listing area navigation", () => {
  it("names the current area and reflects route updates without local selection drift", async () => {
    const view = render(<Header />)
    await userEvent.click(
      screen.getByRole("button", { name: "Listing area: Business profile" })
    )
    expect(
      await screen.findByRole("menuitem", { name: "Opening hours" })
    ).toHaveAttribute("href", "/listings/l1/hours")
    expect(
      screen.getByRole("menuitem", { name: "Business profile" })
    ).toHaveAttribute("aria-current", "page")
    await userEvent.keyboard("{Escape}")
    view.rerender(<Header current="hours" />)
    expect(
      screen.getByRole("button", { name: "Listing area: Opening hours" })
    ).toBeInTheDocument()
  })
  it("keeps admin areas hidden from members and explains unavailable areas", async () => {
    render(<Header role="member" />)
    await userEvent.click(
      screen.getByRole("button", { name: "Listing area: Business profile" })
    )
    expect(
      screen.queryByRole("menuitem", { name: /People with access/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: /Verification/ })
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole("menuitem", { name: /Food menu/ })
    ).toHaveAttribute("aria-disabled", "true")
  })
  it("keeps the existing dirty guard on menu links, including cancel and confirm", async () => {
    render(<Header dirty />)
    await userEvent.click(
      screen.getByRole("button", { name: "Listing area: Business profile" })
    )
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Opening hours" })
    )
    expect(followed).not.toHaveBeenCalled()
    expect(
      screen.getByRole("dialog", { name: "Leave without saving?" })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }))
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Opening hours" })
    )
    fireEvent.click(screen.getByRole("button", { name: "Leave and discard" }))
    expect(followed).toHaveBeenCalledExactlyOnceWith("/listings/l1/hours")
  })
  it("keeps a readable area reachable when publishing is blocked for the role", async () => {
    render(<Header role="viewer" publishBlocked />)
    await userEvent.click(
      screen.getByRole("button", { name: "Listing area: Business profile" })
    )
    const item = await screen.findByRole("menuitem", { name: /Opening hours/ })
    expect(item).not.toHaveAttribute("aria-disabled", "true")
    await userEvent.click(item)
    expect(followed).toHaveBeenCalledExactlyOnceWith("/listings/l1/hours")
  })
})
