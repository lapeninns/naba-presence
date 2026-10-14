import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useRef, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import {
  MenuEditor,
  stripDraftKeys,
  validateMenu,
  type MenuFieldNavigator,
} from "@/components/locations/menu-editor"
import { compareMenuReplacement } from "@/lib/locations/menu-diff"
import { ValidationSummary } from "@/components/ui/validation-summary"

const largeMenu = () => [
  {
    labels: [{ displayName: "Menu" }],
    sections: Array.from({ length: 33 }, (_, section) => ({
      labels: [{ displayName: `Section ${section + 1}` }],
      items: Array.from({ length: section < 10 ? 9 : 8 }, (_, item) => ({
        labels: [
          {
            displayName: `Dish ${section + 1}-${item + 1}`,
            description: `Ingredients ${section + 1}-${item + 1}`,
          },
        ],
        options: [{ retained: true }],
      })),
    })),
  },
]
function Harness({
  initial = largeMenu(),
  onChange = () => {},
  changedPaths = ["menus[0].sections[12].items[2].labels[0].description"],
}: {
  initial?: ReturnType<typeof largeMenu>
  onChange?: () => void
  changedPaths?: string[]
}) {
  const [menus, setMenus] = useState(initial)
  const [attempt, setAttempt] = useState(0)
  const navigator = useRef<MenuFieldNavigator>(null)
  const problems = attempt > 0 ? validateMenu(menus) : []
  return (
    <>
      <ValidationSummary
        errors={problems}
        onNavigate={(fieldId) => navigator.current?.(fieldId)}
      />
      <MenuEditor
        menus={menus}
        disabled={false}
        onChange={(next) => {
          setMenus(next as ReturnType<typeof largeMenu>)
          onChange()
        }}
        problems={problems}
        validationAttempt={attempt}
        changedPaths={changedPaths}
        navigatorRef={navigator}
      />
      <button onClick={() => setAttempt((current) => current + 1)}>
        Validate
      </button>
      <output data-testid="serialized">
        {JSON.stringify(stripDraftKeys(menus))}
      </output>
    </>
  )
}

/** An item's row (its fields are in the item's sheet). */
const itemRow = (name: string) =>
  screen.getByRole("button", { name: `Edit ${name}` })

async function closeItem(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Done" })
  )
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  )
}

describe("large menu navigation", () => {
  it("searches names and descriptions without changing the complete menu", async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    render(<Harness onChange={changed} />)
    const original = screen.getByTestId("serialized").textContent
    await user.click(screen.getByRole("searchbox", { name: "Search menu" }))
    await user.paste("Ingredients 33-8")
    expect(
      screen.getByText("1 of 274 items shown · 33 sections total")
    ).toBeInTheDocument()
    expect(itemRow("Dish 33-8")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Edit Dish 1-1" })
    ).not.toBeInTheDocument()
    expect(screen.getByTestId("serialized").textContent).toBe(original)
    expect(changed).not.toHaveBeenCalled()
  })
  it("filters changed items and retains hidden items when editing", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(
      screen.getByRole("checkbox", { name: "Changed items only" })
    )
    await user.click(itemRow("Dish 13-3"))
    const item = await screen.findByDisplayValue("Dish 13-3")
    await user.clear(item)
    await user.type(item, "Changed dish")
    // The open sheet keeps its item even though the filter no longer has it.
    expect(item).toHaveValue("Changed dish")
    const saved = JSON.parse(
      screen.getByTestId("serialized").textContent ?? "[]"
    )
    expect(saved[0].sections).toHaveLength(33)
    expect(
      saved[0].sections.flatMap(
        (section: { items: unknown[] }) => section.items
      )
    ).toHaveLength(274)
    expect(saved[0].sections[0].items[0].options).toEqual([{ retained: true }])
    expect(saved[0].sections[12].items[2].labels[0].displayName).toBe(
      "Changed dish"
    )
  })
  // Repeated full-form reveals of 274 items need extra budget during parallel suites.
  it("reveals collapsed and filtered invalid fields on validation", async () => {
    const user = userEvent.setup()
    const initial = largeMenu()
    initial[0].sections[32].items[7].labels[0].displayName = ""
    render(<Harness initial={initial} />)
    const search = screen.getByRole("searchbox", { name: "Search menu" })
    const validate = screen.getByRole("button", { name: "Validate" })
    await user.click(
      screen.getByRole("button", { name: "Collapse all sections" })
    )
    await user.click(search)
    await user.paste("absent")
    await user.click(validate)
    const lastSection = screen.getByRole("region", {
      name: "Section 33",
      hidden: true,
    })
    // The invalid item's row is shown, saying what is wrong in words.
    const row = within(lastSection).getByRole("button", { name: "Edit untitled item 8" })
    expect(row).toBeVisible()
    expect(row).toHaveAccessibleDescription(
      expect.stringContaining("Section 33, item 8: name this item.")
    )
    // The summary's link opens that item's sheet on the field.
    await user.click(
      screen.getByRole("link", { name: "Section 33, item 8: name this item." })
    )
    const field = await screen.findByRole("textbox", {
      name: "Item name — section 33, item 8",
    })
    expect(field).toBeVisible()
    await waitFor(() => expect(field).toHaveFocus())
    await closeItem(user)
    await user.click(search)
    await user.paste("absent")
    await user.click(validate)
    expect(
      within(
        screen.getByRole("region", { name: "Section 33", hidden: true })
      ).getByRole("button", { name: "Edit untitled item 8" })
    ).toBeVisible()
    expect(search).toHaveValue("")
    expect(
      within(
        screen.getByRole("region", { name: "Section 33", hidden: true })
      ).getByRole("button", { name: "Collapse Section 33" })
    ).toHaveAttribute("aria-expanded", "true")
    expect(
      screen.getByText("274 of 274 items shown · 33 sections total")
    ).toBeVisible()
    expect(initial[0].sections).toHaveLength(33)
    expect(
      initial[0].sections.flatMap((section) => section.items)
    ).toHaveLength(274)
  }, 15_000)
  it("keeps duplicate-name field identity when reordered", async () => {
    const user = userEvent.setup()
    const initial = largeMenu()
    initial[0].sections = initial[0].sections.slice(0, 1)
    initial[0].sections[0].items = initial[0].sections[0].items.slice(0, 2)
    for (const item of initial[0].sections[0].items)
      item.labels[0].displayName = "Soup"
    render(<Harness initial={initial} />)
    const first = screen
      .getByText("Ingredients 1-1")
      .closest('[data-slot="menu-item-row"]')
    await user.click(
      screen.getAllByRole("button", { name: "Actions for Soup" })[0]
    )
    await user.click(await screen.findByRole("menuitem", { name: "Move down" }))
    const moved = screen
      .getByText("Ingredients 1-1")
      .closest('[data-slot="menu-item-row"]')
    expect(moved).toBe(first)
    expect(
      within(screen.getByRole("list", { name: "Items in Section 1" }))
        .getAllByRole("listitem")
        .indexOf(moved as HTMLElement)
    ).toBe(1)
    await user.click(
      within(moved as HTMLElement).getByRole("button", { name: "Edit Soup" })
    )
    expect(await screen.findByDisplayValue("Ingredients 1-1")).toHaveAttribute(
      "aria-label",
      "Description — section 1, item 2"
    )
  })

  it("jumps to a collapsed section with keyboard focus", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole("combobox", { name: "Jump to section" }))
    await user.click(await screen.findByRole("option", { name: "Section 33" }))
    expect(screen.getByDisplayValue("Section 33")).toHaveFocus()
    expect(itemRow("Dish 33-8")).toBeVisible()
    await user.click(screen.getByRole("searchbox", { name: "Search menu" }))
    await user.click(screen.getByRole("combobox", { name: "Jump to section" }))
    await user.click(await screen.findByRole("option", { name: "Section 33" }))
    expect(screen.getByDisplayValue("Section 33")).toHaveFocus()
    expect(screen.getByRole("searchbox", { name: "Search menu" })).toHaveValue(
      ""
    )
  })
  it.each(["section", "menu"])(
    "includes added %s descendants in changed items",
    async (addition) => {
      const user = userEvent.setup()
      const initial = largeMenu()
      const google =
        addition === "menu"
          ? []
          : [{ ...initial[0], sections: initial[0].sections.slice(0, 32) }]
      const rows = compareMenuReplacement({ draft: initial, google }).rows
      const changedPaths = rows.flatMap((row) =>
        row.draftPath ? [row.draftPath] : []
      )
      render(<Harness initial={initial} changedPaths={changedPaths} />)
      await user.click(
        screen.getByRole("checkbox", { name: "Changed items only" })
      )
      expect(itemRow("Dish 33-8")).toBeVisible()
      expect(screen.getByTestId("serialized").textContent).toBe(
        JSON.stringify(initial)
      )
    }
  )
  it("keeps the active matching description mounted until editing ends", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const search = screen.getByRole("searchbox", { name: "Search menu" })
    await user.click(search)
    await user.paste("Ingredients 33-8")
    await user.click(itemRow("Dish 33-8"))
    const description = await screen.findByRole("textbox", {
      name: "Description — section 33, item 8",
    })
    await user.clear(description)
    await user.type(description, "New recipe")
    expect(description).toHaveFocus()
    expect(description).toHaveValue("New recipe")
    // Behind the open (modal) sheet, its row stays in the filtered list.
    expect(
      screen.getByRole("button", { name: "Edit Dish 33-8", hidden: true })
    ).toBeInTheDocument()
    await closeItem(user)
    await user.click(search)
    expect(description).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Edit Dish 33-8" })
    ).not.toBeInTheDocument()
    expect(screen.getByText(/No items match these filters/)).toBeVisible()
  })
  it("returns focus to the search field when the edited row no longer matches", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const search = screen.getByRole("searchbox", { name: "Search menu" })
    await user.click(search)
    await user.paste("Dish 33-8")
    await user.click(itemRow("Dish 33-8"))
    const name = await screen.findByRole("textbox", {
      name: "Item name — section 33, item 8",
    })
    await user.clear(name)
    await user.type(name, "Renamed")
    await closeItem(user)
    // The row unmounted on close (the search no longer matches it), so focus
    // lands on the search field rather than on <body>.
    expect(
      screen.queryByRole("button", { name: "Edit Renamed" })
    ).not.toBeInTheDocument()
    await waitFor(() => expect(search).toHaveFocus())
    expect(document.body).not.toHaveFocus()
  })
  it("keeps the searched section name mounted until editing ends", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const search = screen.getByRole("searchbox", { name: "Search menu" })
    await user.click(search)
    await user.paste("Section 33")
    const section = screen.getByRole("textbox", { name: "Section 33 name" })
    await user.clear(section)
    await user.type(section, "New section")
    expect(section).toHaveFocus()
    expect(section).toHaveValue("New section")
    await user.click(search)
    expect(section).not.toBeInTheDocument()
  })
})
