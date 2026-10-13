import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BellIcon, PaletteIcon } from "lucide-react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import {
  SettingsDestructiveAction,
  SettingsGroup,
  SettingsGroupAction,
  SettingsRow,
} from "@/components/ui/settings-row"

function Notifications({ onToggleAll }: { onToggleAll?: () => void }) {
  const [on, setOn] = useState(false)
  return (
    <SettingsGroup
      label="Notifications per event"
      card
      action={
        <SettingsGroupAction onClick={onToggleAll}>
          Turn all on
        </SettingsGroupAction>
      }
    >
      <SettingsRow
        icon={<BellIcon />}
        label="New review"
        description="Every new review at your venues"
        checked={on}
        onCheckedChange={setOn}
      />
    </SettingsGroup>
  )
}

describe("SettingsGroup", () => {
  it("is a section named by its sentence-case label, 24px above, with a real text action", async () => {
    const user = userEvent.setup()
    const onToggleAll = vi.fn()
    render(<Notifications onToggleAll={onToggleAll} />)
    const section = screen.getByRole("region", {
      name: "Notifications per event",
    })
    expect(section).toHaveClass("mt-6")
    const label = screen.getByRole("heading", {
      level: 2,
      name: "Notifications per event",
    })
    expect(label).toHaveClass("text-ui", "font-medium", "text-ink-muted")
    // No card on a phone; a bordered card only at the desk.
    const rows = section.querySelector('[data-slot="settings-group-rows"]')!
    expect(rows.className).not.toMatch(/(^|\s)border(\s|$)/)
    expect(rows).toHaveClass("desk:border", "desk:rounded-(--np-radius-card)")

    const action = screen.getByRole("button", { name: "Turn all on" })
    expect(action.tagName).toBe("BUTTON")
    expect(action).toHaveClass("min-h-(--np-touch)")
    action.focus()
    await user.keyboard("{Enter}")
    expect(onToggleAll).toHaveBeenCalledOnce()
  })
})

describe("SettingsRow", () => {
  it("is a switch row: the words toggle, the switch is named and described, 44px kept", async () => {
    const user = userEvent.setup()
    render(<Notifications />)
    const toggle = screen.getByRole("switch", { name: "New review" })
    expect(toggle).toHaveAccessibleDescription(
      "Every new review at your venues"
    )
    expect(toggle).toHaveAttribute("aria-checked", "false")
    // The switch keeps its 44px hit box on touch.
    expect(toggle.className).toContain(
      "before:inset-y-[calc((100%-var(--np-touch))/2)]"
    )

    await user.click(screen.getByText("New review"))
    expect(toggle).toHaveAttribute("aria-checked", "true")

    toggle.focus()
    await user.keyboard(" ")
    expect(toggle).toHaveAttribute("aria-checked", "false")

    const row = toggle.closest("label")!
    expect(row).toHaveClass("min-h-(--np-settings-row-h)")
  })

  it("draws the 28px leading circle with an 18px, 1.5-stroke icon", () => {
    render(
      <SettingsGroup label="Display">
        <SettingsRow icon={<PaletteIcon />} label="Theme" value="System" />
      </SettingsGroup>
    )
    const circle = document.querySelector('[data-slot="settings-row-icon"]')!
    expect(circle).toHaveClass(
      "size-7",
      "rounded-(--np-radius-pill)",
      "bg-fill-secondary",
      "[&_svg]:size-4.5",
      "[&_svg]:[stroke-width:1.5]"
    )
    expect(circle).toHaveAttribute("aria-hidden", "true")
    expect(screen.getByText("System")).toHaveClass("text-ink-muted")
    expect(screen.getByRole("listitem")).toHaveAttribute("data-kind", "static")
  })

  it("is a link with a chevron when given href", () => {
    render(
      <SettingsGroup label="Preferences">
        <SettingsRow
          icon={<BellIcon />}
          label="Notifications"
          href="/settings/notifications"
        />
      </SettingsGroup>
    )
    const link = screen.getByRole("link", { name: "Notifications" })
    expect(link).toHaveAttribute("href", "/settings/notifications")
    expect(link).toHaveClass("min-h-(--np-settings-row-h)", "focus-halo")
    expect(
      link.querySelector('[data-slot="settings-row-chevron"]')
    ).toBeInTheDocument()
  })

  it("is a button with its value and a chevron when given onClick", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <SettingsGroup label="Display">
        <SettingsRow label="Appearance" value="System" onClick={onClick} />
      </SettingsGroup>
    )
    const group = screen.getByRole("list")
    const button = within(group).getByRole("button", { name: /Appearance/ })
    expect(button).toHaveTextContent("System")
    button.focus()
    await user.keyboard("{Enter}")
    await user.keyboard(" ")
    expect(onClick).toHaveBeenCalledTimes(2)
  })
})

describe("SettingsDestructiveAction", () => {
  it("is a centred danger-ink text button that only reports the press", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <SettingsDestructiveAction onClick={onClick}>
        Disconnect Google account
      </SettingsDestructiveAction>
    )
    const button = screen.getByRole("button", {
      name: "Disconnect Google account",
    })
    expect(button).toHaveClass("text-danger-ink", "min-h-(--np-touch)")
    expect(button.parentElement).toHaveClass("justify-center")
    await user.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })
})
