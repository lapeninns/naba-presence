import { readFileSync } from "node:fs"
import { join } from "node:path"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import Link from "next/link"
import * as React from "react"
import { describe, expect, it, vi } from "vitest"

import { Checkbox } from "@/components/ui/checkbox"
import { TokenChip, TokenChipList } from "@/components/ui/chip"
import {
  GroupedList,
  GroupedListItem,
  GroupedListRow,
} from "@/components/ui/grouped-list"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { OptionRow, OptionRowGroup } from "@/components/ui/option-row"
import { SettingsGroup, SettingsRow } from "@/components/ui/settings-row"
import {
  TabNav,
  tabItemClassName,
  textTabItemClassName,
  useScrollFade,
} from "@/components/ui/tabs"
import { MEDIA_QUERIES, TALL_MIN_HEIGHT } from "@/lib/ui/breakpoints"

const globals = readFileSync(join(process.cwd(), "app/globals.css"), "utf8")

describe("tall variant (F6)", () => {
  it("mirrors the CSS custom variant in lib/ui/breakpoints", () => {
    const media = globals
      .match(/@custom-variant\s+tall\s*\(\s*@media\s+([^;]+?)\s*\)\s*;/)?.[1]
      ?.replace(/\s+/g, " ")
    expect(media).toBe(MEDIA_QUERIES.tall)
    expect(TALL_MIN_HEIGHT).toEqual({ rem: 38.75, px: 620 })
  })
})

describe("tabs (F7, R2 A-N7)", () => {
  it("draws aria-current=location like page, with an inset focus ring", () => {
    for (const cls of [tabItemClassName, textTabItemClassName]) {
      expect(cls).toContain("aria-[current=location]:font-semibold")
      expect(cls).toContain("aria-[current=location]:text-ink")
      expect(cls).toContain("aria-[current=location]:after:bg-ink")
      // The sideways-scrolling row clips an outer halo.
      expect(cls).toContain("focus-ring-inset")
      expect(cls).not.toContain("focus-halo")
    }
    render(
      <TabNav
        aria-label="Sections"
        items={[
          { href: "/a", label: "Alpha", current: true },
          { href: "/b", label: "Beta" },
        ]}
      />
    )
    expect(screen.getByRole("link", { name: "Alpha" })).toHaveClass(
      "focus-ring-inset"
    )
  })

  it("exports useScrollFade, which marks a row with nothing hidden as unfaded", () => {
    function Row() {
      const ref = React.useRef<HTMLDivElement>(null)
      useScrollFade(ref)
      return <div ref={ref} data-testid="row" data-fade="end" />
    }
    render(<Row />)
    // jsdom has no layout: everything "fits", so the fade is cleared.
    expect(screen.getByTestId("row")).not.toHaveAttribute("data-fade")
  })
})

describe("GroupedList (F7, R1 S5)", () => {
  it("passes listClassName to the ul and keeps className on the wrapper", () => {
    const { container } = render(
      <GroupedList header="Attributes" className="outer" listClassName="inner">
        <GroupedListItem label="Wi-Fi" />
      </GroupedList>
    )
    const list = screen.getByRole("list", { name: "Attributes" })
    expect(list).toHaveClass("inner", "overflow-hidden")
    expect(list).not.toHaveClass("outer")
    expect(container.firstElementChild).toHaveClass("outer")
  })

  it("GroupedListRow carries the inset hairline around arbitrary children", () => {
    render(
      <GroupedList header="Attributes">
        <GroupedListItem label="Wi-Fi" />
        <GroupedListRow icon data-testid="custom">
          <label>
            Outdoor seating <input type="checkbox" />
          </label>
        </GroupedListRow>
        <GroupedListRow padded={false} data-testid="bare">
          <span>Bare</span>
        </GroupedListRow>
      </GroupedList>
    )
    const custom = screen.getByTestId("custom")
    expect(custom.tagName).toBe("LI")
    expect(custom).toHaveClass(
      "before:left-(--gl-inset)",
      "first:before:hidden"
    )
    expect(custom).toHaveClass("min-h-(--np-row-h)", "px-(--np-card-pad)")
    expect(custom.style.getPropertyValue("--gl-inset")).toContain("1.25rem")
    expect(screen.getByTestId("bare")).not.toHaveClass("px-(--np-card-pad)")
    expect(
      within(custom).getByRole("checkbox", { name: "Outdoor seating" })
    ).toBeInTheDocument()
  })

  it("focuses interactive rows with the inset ring, not the clipped halo", () => {
    render(
      <GroupedList header="Account">
        <GroupedListItem label="Profile" href="/profile" />
        <GroupedListItem label="Sign out" onClick={() => {}} />
      </GroupedList>
    )
    for (const el of [
      screen.getByRole("link", { name: "Profile" }),
      screen.getByRole("button", { name: "Sign out" }),
    ]) {
      expect(el).toHaveClass("focus-ring-inset")
      expect(el.className).not.toContain("focus-halo")
    }
  })
})

describe("SettingsRow inset focus (R1 S5, R2 A-S3)", () => {
  it("uses the inset ring on button rows", () => {
    render(
      <SettingsGroup label="Display" card>
        <SettingsRow label="Appearance" onClick={() => {}} />
      </SettingsGroup>
    )
    const row = screen.getByRole("button", { name: "Appearance" })
    expect(row).toHaveClass("focus-ring-inset")
    expect(row).not.toHaveClass("focus-halo")
  })
})

describe("OptionRow link mode (F6)", () => {
  it("renders a real link with the row look and aria-current, and no radio role inside a group", () => {
    render(
      <OptionRowGroup label="Areas">
        <OptionRow
          href="/listings/1/profile"
          indicator="check"
          label="Profile"
          selected
        />
        <OptionRow href="/listings/1/hours" indicator="check" label="Hours" />
      </OptionRowGroup>
    )
    expect(screen.queryByRole("radio")).not.toBeInTheDocument()
    const current = screen.getByRole("link", { name: "Profile" })
    expect(current.tagName).toBe("A")
    expect(current).toHaveAttribute("href", "/listings/1/profile")
    expect(current).toHaveAttribute("aria-current", "page")
    expect(current).not.toHaveAttribute("aria-checked")
    expect(current).not.toHaveAttribute("type")
    expect(current).toHaveClass("min-h-(--np-touch)", "focus-ring-inset")
    // The current area still draws its ✓.
    expect(
      current.querySelector('[data-slot="option-row-check"] svg')
    ).toBeInTheDocument()
    const other = screen.getByRole("link", { name: "Hours" })
    expect(other).not.toHaveAttribute("aria-current")
  })

  it("takes a render element (e.g. a guarded ShellLink) and passes aria-current through", () => {
    render(
      <OptionRow
        render={<Link href="/listings/2" data-guarded="" />}
        label="The Bell"
        description="Sibling listing"
        aria-current="location"
      />
    )
    const link = screen.getByRole("link", { name: "The Bell" })
    expect(link).toHaveAttribute("data-guarded")
    expect(link).toHaveAttribute("href", "/listings/2")
    expect(link).toHaveAttribute("aria-current", "location")
    expect(link).toHaveAccessibleDescription("Sibling listing")
  })

  it("is a menuitem in a menu, and a disabled link has no href", () => {
    render(
      <div role="menu" aria-label="Switch area">
        <OptionRowGroup menu>
          <OptionRow href="/a" label="Photos" />
          <OptionRow
            href="/b"
            label="People"
            disabled
            description="Owners only"
          />
        </OptionRowGroup>
      </div>
    )
    expect(screen.getByRole("menuitem", { name: "Photos" })).toHaveAttribute(
      "href",
      "/a"
    )
    const disabled = screen.getByRole("menuitem", { name: "People" })
    expect(disabled).not.toHaveAttribute("href")
    expect(disabled).toHaveAttribute("aria-disabled", "true")
  })
})

describe("ListRow details, flush and wrapperProps (F6, FOUNDATION-B)", () => {
  it("adds a disclosure button outside the hit element with the caller's exact words", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ListRows>
        <ListRow
          title="The Bell"
          subtitle="Published"
          detailsLabel="Show receipt for The Bell"
          details={<p>Receipt body</p>}
          onDetailsOpenChange={onChange}
        />
      </ListRows>
    )
    const toggle = screen.getByRole("button", {
      name: "Show receipt for The Bell",
    })
    const hit = screen.getByRole("button", { name: /^The Bell/ })
    expect(hit).not.toContainElement(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    const region = document.getElementById(
      toggle.getAttribute("aria-controls")!
    )!
    expect(region).toHaveAttribute("hidden")
    expect(screen.queryByText("Receipt body")).not.toBeVisible()
    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(region).not.toHaveAttribute("hidden")
    expect(screen.getByText("Receipt body")).toBeVisible()
    expect(onChange).toHaveBeenLastCalledWith(true)
  })

  it("lets a function label follow the open state, and supports control", async () => {
    const user = userEvent.setup()
    function Controlled() {
      const [open, setOpen] = React.useState(true)
      return (
        <ListRow
          title="Row"
          detailsOpen={open}
          onDetailsOpenChange={setOpen}
          detailsLabel={(o) => (o ? "Hide receipt" : "Show receipt")}
          details="Body"
        />
      )
    }
    render(<Controlled />)
    await user.click(screen.getByRole("button", { name: "Hide receipt" }))
    expect(
      screen.getByRole("button", { name: "Show receipt" })
    ).toHaveAttribute("aria-expanded", "false")
  })

  it("flush drops the page-pad inset and draws a full-width hairline; wrapperProps reach the li", () => {
    render(
      <ListRows>
        <ListRow
          flush
          title="Saved draft"
          wrapperProps={{ "data-status": "failed", className: "extra" }}
          wrapperClassName="mine"
        />
      </ListRows>
    )
    const hit = screen.getByRole("button", { name: "Saved draft" })
    expect(hit).toHaveClass("px-0")
    expect(hit.className).not.toContain("px-(--np-page-pad-x)")
    const li = hit.closest("li")!
    expect(li).toHaveAttribute("data-status", "failed")
    expect(li).toHaveAttribute("data-flush")
    expect(li).toHaveClass("after:inset-x-0", "mine", "extra")
    expect(li.className).not.toContain("after:start-(--np-page-pad-x)")
  })

  it("ListRows listbox: ul listbox, li presentation, rows are options", () => {
    render(
      <ListRows listbox aria-label="Reviews">
        <ListRow title="Amelia" selected />
        <ListRow title="Ben" />
      </ListRows>
    )
    const listbox = screen.getByRole("listbox", { name: "Reviews" })
    const options = within(listbox).getAllByRole("option")
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveAttribute("aria-selected", "true")
    expect(options[1]).toHaveAttribute("aria-selected", "false")
    for (const li of listbox.querySelectorAll("li"))
      expect(li).toHaveAttribute("role", "presentation")
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
  })

  it("gives the leading control a 44px overhang that toggles the control, not the row", async () => {
    const user = userEvent.setup()
    const onRow = vi.fn()
    const onCheck = vi.fn()
    render(
      <ListRows>
        <ListRow
          title="Amelia"
          onClick={onRow}
          leadingControl={
            <Checkbox aria-label="Select Amelia" onCheckedChange={onCheck} />
          }
        />
      </ListRows>
    )
    const wrapper = document.querySelector<HTMLElement>(
      '[data-slot="list-row-control"]'
    )!
    expect(wrapper.className).toContain(
      "after:inset-[calc((100%-var(--np-touch))/2)]"
    )
    expect(wrapper).toHaveClass("desk:after:hidden")
    // A press on the wrapper's overhang (the wrapper itself) selects.
    await user.click(wrapper)
    expect(onCheck).toHaveBeenCalledTimes(1)
    expect(onRow).not.toHaveBeenCalled()
    await user.click(screen.getByRole("checkbox", { name: "Select Amelia" }))
    expect(onCheck).toHaveBeenCalledTimes(2)
  })
})

describe("TokenChip / TokenChipList (F6)", () => {
  it("TokenChip is static: no button, not a tab stop", () => {
    render(<TokenChip>The Bell</TokenChip>)
    const chip = screen.getByText("The Bell")
    expect(chip.tagName).toBe("SPAN")
    expect(chip).toHaveClass("bg-fill-secondary", "min-h-(--np-chip-h)")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("shows the first N and +N more, with every token in the list for AT", () => {
    const items = [
      "The Bell",
      "The Crown",
      "The Railway",
      "The Mow",
      "The Swan",
    ]
    render(
      <TokenChipList
        aria-label="Selected listings"
        max={2}
        items={items.map((label) => ({ id: label, label }))}
      />
    )
    const list = screen.getByRole("list", { name: "Selected listings" })
    // Every token is a list item; "+3 more" is hidden from AT.
    const listItems = within(list).getAllByRole("listitem")
    expect(listItems.map((li) => li.textContent)).toEqual(items)
    expect(listItems[0]).not.toHaveClass("sr-only")
    expect(listItems[2]).toHaveClass("sr-only")
    const more = screen.getByText("+3 more")
    expect(more).toHaveAttribute("aria-hidden", "true")
  })

  it("draws no overflow text when everything fits, and takes a custom label", () => {
    const { rerender } = render(
      <TokenChipList items={[{ id: 1, label: "A" }]} max={3} />
    )
    expect(screen.queryByText(/more/)).not.toBeInTheDocument()
    rerender(
      <TokenChipList
        items={[
          { id: 1, label: "A" },
          { id: 2, label: "B" },
        ]}
        max={1}
        moreLabel={(n) => `and ${n} other`}
      />
    )
    expect(screen.getByText("and 1 other")).toBeInTheDocument()
  })
})
