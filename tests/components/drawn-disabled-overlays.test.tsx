import { readFileSync } from "node:fs"
import path from "node:path"

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Checkbox } from "@/components/ui/checkbox"
import {
  menuPopupClassName,
  menuRowClassName,
} from "@/components/ui/menu-surface"
import { overlayPopupClassName } from "@/components/ui/overlay"
import {
  RadioGroup,
  RadioGroupItem,
  radioClassName,
} from "@/components/ui/radio-group"
import { Switch, switchVariants } from "@/components/ui/switch"

// SYSTEM §12 (Disabled) and §11 / §7.3 (menus and popovers): disabled is
// drawn with the --np-disabled-* roles, never faded; menus are shadow only.

const root = path.resolve(__dirname, "../..")
const source = (file: string) => readFileSync(path.join(root, file), "utf8")

describe("disabled fan-out", () => {
  // Each file SYSTEM §12 lists drew disabled with opacity.
  const files = [
    "components/ui/tabs.tsx",
    "components/ui/selection-bar.tsx",
    "components/ui/switch.tsx",
    "components/ui/radio-group.tsx",
    "components/ui/segmented-control.tsx",
    "components/ui/command.tsx",
    "components/ui/grouped-list.tsx",
    "components/ui/checkbox.tsx",
    "components/ui/choice-card.tsx",
    "components/ui/list-row-swipe.tsx",
    "components/ui/settings-row.tsx",
    "components/app-shell/boundary.tsx",
    "components/app-shell/app-bar.tsx",
  ]

  it.each(files)("%s draws no disabled state with opacity", (file) => {
    expect(source(file)).not.toMatch(
      /(disabled|aria-disabled|data-disabled|data-\[disabled=true\])[^\s"]*:opacity-/
    )
    expect(source(file)).not.toMatch(/\bopacity-(40|50|55|60)\b/)
  })

  it("keeps a checked disabled switch apart from an unchecked one", () => {
    const classes = switchVariants().split(" ")
    expect(classes).toContain("data-disabled:bg-disabled-line")
    expect(classes).toContain("data-disabled:data-checked:bg-disabled-ink")
  })

  it("draws a disabled checkbox on the disabled fill, its tick in the disabled ink", () => {
    render(
      <>
        <Checkbox aria-label="Off" disabled />
        <Checkbox aria-label="On" disabled defaultChecked />
      </>
    )
    const off = screen.getByRole("checkbox", { name: "Off" })
    expect(off).toHaveClass(
      "data-disabled:bg-disabled",
      "data-disabled:border-disabled-line",
      "data-disabled:data-checked:border-disabled-ink",
      "data-disabled:data-checked:text-disabled-ink"
    )
    expect(off.className).not.toMatch(/opacity/)
  })

  it("keeps a selected disabled radio's thick ring, in the disabled ink", () => {
    expect(radioClassName).toContain("data-disabled:bg-disabled")
    expect(radioClassName).toContain("data-disabled:border-disabled-line")
    expect(radioClassName).toContain(
      "data-disabled:data-checked:border-disabled-ink"
    )
    render(
      <RadioGroup aria-label="Plan" defaultValue="a" disabled>
        <RadioGroupItem value="a">Monthly</RadioGroupItem>
      </RadioGroup>
    )
    expect(
      screen.getByRole("radio", { name: "Monthly" }).className
    ).not.toMatch(/opacity/)
  })

  it("renders a labelled disabled switch with no fade on the row", () => {
    render(<Switch label="Auto-publish" disabled />)
    const row = screen.getByText("Auto-publish").closest("label")!
    expect(row.className).not.toMatch(/opacity/)
  })
})

describe("menus and popovers", () => {
  it("draw the float shadow and no border, with a forced-colours edge", () => {
    for (const classes of [
      menuPopupClassName,
      source("components/ui/popover.tsx").match(/"w-\[min\(360px[^"]*"/)![0],
      source("components/ui/dropdown-menu.tsx").match(
        /const popupClassName =\s*"([^"]*)"/
      )![1],
    ]) {
      const list = classes.replace(/"/g, "").split(" ")
      expect(list).toContain("shadow-np-float")
      expect(list).toContain("forced-colors:border")
      expect(list).not.toContain("border")
      expect(list).not.toContain("border-line")
    }
  })

  it("highlight a row with bg-fill, the palette's selected row too", () => {
    expect(menuRowClassName).toContain("data-highlighted:bg-fill")
    const command = source("components/ui/command.tsx")
    expect(command).toContain("data-[selected=true]:bg-fill")
    expect(command).not.toContain("data-[selected=true]:bg-accent-tint")
  })

  it("open with the scale transitioned, so the Select popup does not snap", () => {
    // Tailwind's scale-* writes `scale`, not `transform`.
    expect(menuPopupClassName).toContain("transition-[opacity,scale]")
    expect(menuPopupClassName).not.toContain("transition-[transform")
    // Aligned over its trigger, the popup only fades.
    expect(menuPopupClassName).toContain(
      "data-[side=none]:data-starting-style:scale-100"
    )
    expect(menuPopupClassName).toContain(
      "data-[side=none]:data-ending-style:scale-100"
    )
  })
})

describe("overlay radii", () => {
  it("rounds the right panel's leading corners on the modal radius", () => {
    expect(overlayPopupClassName.panel).toContain(
      "rounded-l-(--np-radius-modal)"
    )
    expect(overlayPopupClassName.dialog).toContain(
      "rounded-(--np-radius-modal)"
    )
    expect(overlayPopupClassName.sheet).toContain(
      "rounded-t-(--np-radius-sheet)"
    )
    expect(overlayPopupClassName.inset).toContain("rounded-sheet-inset")
  })
})
