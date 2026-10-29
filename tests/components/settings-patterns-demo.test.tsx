import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SettingsPatternsDemo } from "@/app/design-system/settings-patterns-demo"

function describedByText(element: HTMLElement) {
  const ids = (element.getAttribute("aria-describedby") ?? "").split(/\s+/)
  return ids
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
}

describe("SettingsPatternsDemo (/design-system)", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("is one labelled block under the page's sections: an h3, no h2, an anchor for the index", () => {
    const { container } = render(<SettingsPatternsDemo />)
    const block = screen.getByRole("region", { name: "Settings patterns" })
    expect(block).toHaveAttribute("id", "ds-settings")
    expect(
      screen.getByRole("heading", { level: 3, name: "Settings patterns" })
    ).toBeInTheDocument()
    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0)
    // Unique ids (axe duplicate-id).
    const ids = Array.from(container.querySelectorAll("[id]")).map(
      (node) => node.id
    )
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("claims a typed confirmation only for a Google disconnect", () => {
    render(<SettingsPatternsDemo />)
    const block = screen.getByRole("region", { name: "Settings patterns" })
    expect(block).not.toHaveTextContent(/removing anything opens a typed/i)
    expect(block).toHaveTextContent(
      "only a Google disconnect asks you to type the login"
    )
  })

  it("says why a row can't change, in words the control is described by", () => {
    render(<SettingsPatternsDemo />)
    const role = screen.getByRole("button", { name: /Role/ })
    expect(role).toBeDisabled()
    expect(describedByText(role)).toBe(
      "Make someone else an owner before changing the last owner’s role."
    )

    const remove = screen.getByRole("button", { name: "Remove from team…" })
    expect(remove).toBeDisabled()
    expect(describedByText(remove)).toBe("You can’t remove your own access.")

    const publish = screen.getByRole("switch", { name: "Can publish" })
    expect(publish).toBeChecked()
    expect(publish).toHaveAttribute("aria-disabled", "true")
    expect(describedByText(publish)).toBe(
      "Owners and admins can always publish."
    )

    const notes = screen.getAllByRole("note").map((note) => note.textContent)
    expect(notes).toEqual([
      "Make someone else an owner before changing the last owner’s role.",
      "You can’t remove your own access.",
      "Owners and admins can always publish.",
    ])
  })

  it("shows a link row, a pill-and-sentence status, and a Needs attention list of links", () => {
    render(<SettingsPatternsDemo />)
    expect(
      screen.getByRole("link", { name: /Location access/ })
    ).toHaveAttribute("href", "#ds-settings-rows")
    expect(screen.getByText("On")).toBeInTheDocument()
    expect(screen.getByText("Off")).toBeInTheDocument()
    expect(
      screen.getByText("Signing in needs only your password.")
    ).toBeInTheDocument()
    const attention = screen.getByRole("list", { name: "Needs attention" })
    expect(within(attention).getAllByRole("link")).toHaveLength(2)
    expect(
      within(attention).getByRole("link", { name: /Syncs that failed/ })
    ).toBeInTheDocument()
  })

  it("shows the outcome only after the (simulated) server confirms, as a polite status", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SettingsPatternsDemo />)
    expect(screen.queryByText("Preferences saved")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Save preferences" }))
    // Pending: the button says what it is doing, and nothing claims success.
    expect(screen.getByRole("button", { name: /Saving…/ })).toBeInTheDocument()
    expect(screen.queryByText("Preferences saved")).not.toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("Preferences saved")
  })
})
