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
    // D8: section labels are sentence-case caption medium muted ink.
    expect(label).toHaveClass("text-caption", "font-medium", "text-ink-muted")
    expect(label.className).not.toMatch(/font-mono|uppercase/)
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

describe("SettingsGroup slots (F7, F3)", () => {
  it("names its heading from the id, focusable by script only, with caption and actions", () => {
    render(
      <SettingsGroup
        id="hours"
        headingAs="h3"
        label="Opening hours"
        caption="Saved together with the rest of the profile."
        actions={
          <SettingsGroupAction onClick={() => {}}>
            Open profile
          </SettingsGroupAction>
        }
      >
        <SettingsRow label="Monday" value="11:00–23:00" />
      </SettingsGroup>
    )
    const section = screen.getByRole("region", { name: "Opening hours" })
    expect(section).toHaveAttribute("id", "hours")
    expect(section).toHaveAccessibleDescription(
      "Saved together with the rest of the profile."
    )
    const heading = screen.getByRole("heading", {
      level: 3,
      name: "Opening hours",
    })
    expect(heading).toHaveAttribute("id", "hours-heading")
    expect(heading).toHaveAttribute("tabindex", "-1")
    expect(heading).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-(--np-focus-ring)",
      "forced-colors:focus-visible:outline-2",
      "forced-colors:focus-visible:outline-solid"
    )
    document.getElementById("hours-heading")!.focus()
    expect(heading).toHaveFocus()
    expect(
      screen.getByRole("button", { name: "Open profile" })
    ).toBeInTheDocument()
  })

  it("keeps `as` working and lets headingId win", () => {
    render(
      <SettingsGroup as="h3" id="x" headingId="custom" label="Display">
        <SettingsRow label="Theme" value="System" />
      </SettingsGroup>
    )
    expect(
      screen.getByRole("heading", { level: 3, name: "Display" })
    ).toHaveAttribute("id", "custom")
  })

  it("draws a card footer that saves once, with a group-level Turn all action", async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onToggleAll = vi.fn()
    render(
      <SettingsGroup
        label="Notifications per event"
        card
        action={
          <SettingsGroupAction onClick={onToggleAll}>
            Turn all on
          </SettingsGroupAction>
        }
        footer={
          <button type="button" onClick={onSave}>
            Save
          </button>
        }
      >
        <SettingsRow
          label="New review"
          checked={false}
          onCheckedChange={() => {}}
        />
        <SettingsRow
          label="Reply published"
          checked
          onCheckedChange={() => {}}
        />
      </SettingsGroup>
    )
    const section = screen.getByRole("region", {
      name: "Notifications per event",
    })
    const footer = section.querySelector<HTMLElement>(
      '[data-slot="settings-group-footer"]'
    )!
    // The footer sits after the rows, inside the desk card.
    expect(
      section.querySelector('[data-slot="settings-group-rows"]')!
        .nextElementSibling
    ).toBe(footer)
    expect(footer).toHaveClass(
      "desk:border",
      "desk:rounded-b-(--np-radius-card)"
    )
    expect(
      section.querySelector('[data-slot="settings-group-rows"]')
    ).toHaveClass("desk:rounded-b-none")
    // One Save for the group, outside the list.
    expect(within(footer).getAllByRole("button")).toHaveLength(1)
    expect(screen.getByRole("list")).not.toContainElement(
      screen.getByRole("button", { name: "Save" })
    )
    await user.click(screen.getByRole("button", { name: "Turn all on" }))
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(onToggleAll).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledOnce()
  })
})

describe("SettingsRow inline field (F7)", () => {
  it("puts the label and description above the field, with no link or button wrapper", async () => {
    const user = userEvent.setup()
    render(
      <SettingsGroup label="Business information">
        <SettingsRow
          label="Business name"
          description="As it appears on Google."
          changed="Changed"
          controlId="name"
          control={
            <input
              id="name"
              aria-describedby="name-description"
              defaultValue="Old Crown"
            />
          }
        />
      </SettingsGroup>
    )
    const field = screen.getByRole("textbox", { name: "Business name" })
    expect(field).toHaveAccessibleDescription("As it appears on Google.")
    const row = screen.getByRole("listitem")
    expect(row).toHaveAttribute("data-kind", "field")
    expect(within(row).queryByRole("button")).toBeNull()
    expect(within(row).queryByRole("link")).toBeNull()
    // The words come first: label, then the field below.
    const label = screen.getByText("Business name")
    expect(label.tagName).toBe("LABEL")
    expect(
      label.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    // "Changed" is a word, not a dot, and not part of the field's name.
    expect(screen.getByText("Changed")).toHaveAttribute(
      "data-slot",
      "settings-row-changed"
    )
    await user.click(label)
    expect(field).toHaveFocus()
  })

  it("shows the changed word on a switch row without renaming the switch", () => {
    render(
      <SettingsGroup label="Notifications">
        <SettingsRow
          label="New review"
          changed="Changed"
          checked
          onCheckedChange={() => {}}
        />
      </SettingsGroup>
    )
    const toggle = screen.getByRole("switch", { name: "New review" })
    // Words first: the changed word is announced as the description.
    expect(toggle).toHaveAccessibleDescription("Changed")
    expect(screen.getByText("Changed")).toHaveClass("text-caption")
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
    // Inset ring (R1 S5 / R2 A-S3): a desk card group clips an outer halo.
    expect(link).toHaveClass("min-h-(--np-settings-row-h)", "focus-ring-inset")
    expect(link).not.toHaveClass("focus-halo")
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
