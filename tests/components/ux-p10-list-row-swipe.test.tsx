import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ListRow, ListRows } from "@/components/ui/list-row"

const ACTION_WIDTH = 80

function actions(onArchive = vi.fn(), onDelete = vi.fn()) {
  return [
    { label: "Archive", onAction: onArchive },
    { label: "Delete", tone: "danger" as const, onAction: onDelete },
  ] as const
}

const slideOf = (row: HTMLElement) =>
  row
    .closest('[data-slot="list-row"]')!
    .querySelector<HTMLElement>('[data-slot="list-row-swipe-slide"]')!
const panelOf = (row: HTMLElement) =>
  row
    .closest('[data-slot="list-row"]')!
    .querySelector<HTMLElement>('[data-slot="list-row-swipe-actions"]')!
const surfaceOf = (row: HTMLElement) =>
  row
    .closest('[data-slot="list-row"]')!
    .querySelector<HTMLElement>('[data-slot="list-row-swipe"]')!

/** A finger from (x, y), dragged by (dx, dy) in three moves, then lifted. */
function swipe(
  target: HTMLElement,
  dx: number,
  dy = 0,
  { release = true, pointerType = "touch", id = 1 } = {}
) {
  const init = { pointerType, pointerId: id, isPrimary: true }
  fireEvent.pointerDown(target, { ...init, clientX: 300, clientY: 100 })
  for (const step of [1, 2, 3]) {
    fireEvent.pointerMove(target, {
      ...init,
      clientX: 300 + (dx * step) / 3,
      clientY: 100 + (dy * step) / 3,
    })
  }
  if (release)
    fireEvent.pointerUp(target, {
      ...init,
      clientX: 300 + dx,
      clientY: 100 + dy,
    })
}

const x = (row: HTMLElement) =>
  surfaceOf(row).style.getPropertyValue("--swipe-x")

afterEach(() => {
  vi.useRealTimers()
})

describe("ListRow swipeActions", () => {
  it("draws no swipe surface and no menu button without actions", () => {
    render(<ListRow title="Amelia Hart" />)
    expect(
      document.querySelector('[data-slot="list-row-swipe"]')
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole("button")).toHaveLength(1)
  })

  it("reveals the actions on a left swipe and settles open", () => {
    const onArchive = vi.fn()
    render(<ListRow title="Amelia Hart" swipeActions={actions(onArchive)} />)
    const row = screen.getByRole("button", { name: "Amelia Hart" })
    const slide = slideOf(row)
    // Closed: the actions are inert, so never a tab stop behind the row.
    expect(panelOf(row)).toHaveAttribute("inert")
    expect(x(row)).toBe("0px")

    swipe(slide, -150)
    expect(x(row)).toBe(`-${2 * ACTION_WIDTH}px`)
    expect(surfaceOf(row)).toHaveAttribute("data-open")
    expect(panelOf(row)).not.toHaveAttribute("inert")
    expect(screen.getByRole("button", { name: "Archive" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute(
      "data-tone",
      "danger"
    )

    fireEvent.click(screen.getByRole("button", { name: "Archive" }))
    expect(onArchive).toHaveBeenCalledOnce()
    // Using an action closes the row.
    expect(x(row)).toBe("0px")
  })

  it("settles closed when the swipe is short", () => {
    render(<ListRow title="Amelia Hart" swipeActions={actions()} />)
    const row = screen.getByRole("button", { name: "Amelia Hart" })
    swipe(slideOf(row), -40)
    expect(x(row)).toBe("0px")
    expect(surfaceOf(row)).not.toHaveAttribute("data-open")
  })

  it("does not take a vertical drag, so the list still scrolls", () => {
    render(<ListRow title="Amelia Hart" swipeActions={actions()} />)
    const row = screen.getByRole("button", { name: "Amelia Hart" })
    const slide = slideOf(row)
    expect(slide.className).toContain("touch-pan-y")
    swipe(slide, -20, 90)
    expect(x(row)).toBe("0px")
    expect(surfaceOf(row)).not.toHaveAttribute("data-open")
  })

  it("ignores a mouse drag: the button is a mouse's path", () => {
    render(<ListRow title="Amelia Hart" swipeActions={actions()} />)
    const row = screen.getByRole("button", { name: "Amelia Hart" })
    swipe(slideOf(row), -150, 0, { pointerType: "mouse" })
    expect(x(row)).toBe("0px")
  })

  it("does not open the row when a swipe ends, and a tap on an open row closes it", () => {
    const onClick = vi.fn()
    render(
      <ListRow title="Amelia Hart" onClick={onClick} swipeActions={actions()} />
    )
    const row = screen.getByRole("button", { name: "Amelia Hart" })
    swipe(slideOf(row), -150)
    // The click a browser sends after the drag's release.
    fireEvent.click(row)
    expect(onClick).not.toHaveBeenCalled()
    expect(x(row)).toBe(`-${2 * ACTION_WIDTH}px`)

    fireEvent.click(row)
    expect(onClick).not.toHaveBeenCalled()
    expect(x(row)).toBe("0px")

    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("closes an open row on a press elsewhere, a scroll and Escape", () => {
    render(
      <>
        <ListRow title="Amelia Hart" swipeActions={actions()} />
        <p>Elsewhere</p>
      </>
    )
    const row = screen.getByRole("button", { name: "Amelia Hart" })
    const open = () => swipe(slideOf(row), -150)

    open()
    fireEvent.pointerDown(screen.getByText("Elsewhere"))
    expect(x(row)).toBe("0px")

    open()
    fireEvent.scroll(window)
    expect(x(row)).toBe("0px")

    open()
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(x(row)).toBe("0px")
  })

  it("keeps one row open at a time", () => {
    render(
      <ListRows>
        <ListRow title="Amelia Hart" swipeActions={actions()} />
        <ListRow title="Tom Reeve" swipeActions={actions()} />
      </ListRows>
    )
    const first = screen.getByRole("button", { name: "Amelia Hart" })
    const second = screen.getByRole("button", { name: "Tom Reeve" })
    swipe(slideOf(first), -150)
    expect(x(first)).toBe(`-${2 * ACTION_WIDTH}px`)
    swipe(slideOf(second), -150, 0, { id: 2 })
    expect(x(second)).toBe(`-${2 * ACTION_WIDTH}px`)
    expect(x(first)).toBe("0px")
  })

  it("follows the finger while dragging and then animates", () => {
    render(<ListRow title="Amelia Hart" swipeActions={actions()} />)
    const row = screen.getByRole("button", { name: "Amelia Hart" })
    const slide = slideOf(row)
    expect(slide.className).toContain("transition-transform")
    swipe(slide, -90, 0, { release: false })
    expect(x(row)).toBe("-90px")
    // Dragging: no transition, so the row sticks to the finger.
    expect(slide.className).not.toContain("transition-transform")
    fireEvent.pointerUp(slide, {
      pointerType: "touch",
      pointerId: 1,
      isPrimary: true,
    })
    expect(slide.className).toContain("transition-transform")
  })

  it("turns the slide transition off for reduced motion", () => {
    render(<ListRow title="Amelia Hart" swipeActions={actions()} />)
    const row = screen.getByRole("button", { name: "Amelia Hart" })
    expect(slideOf(row).className).toContain("motion-reduce:transition-none")
    expect(panelOf(row).className).toContain("motion-reduce:transition-none")
  })

  it("draws the danger action in the danger token", () => {
    render(<ListRow title="Amelia Hart" swipeActions={actions()} />)
    const row = screen.getByRole("button", { name: "Amelia Hart" })
    swipe(slideOf(row), -150)
    const danger = screen.getByRole("button", { name: "Delete" })
    expect(danger.className).toContain("bg-danger-solid")
    expect(danger.className).toContain("text-danger-on-solid")
    expect(screen.getByRole("button", { name: "Archive" }).className).toContain(
      "bg-accent-solid"
    )
  })

  describe("the visible button alternative", () => {
    it("is always drawn, named for the row, outside the row's hit element", () => {
      render(
        <ListRow
          title="Amelia Hart"
          actionsLabel="Actions for Amelia Hart"
          swipeActions={actions()}
        />
      )
      const more = screen.getByRole("button", {
        name: "Actions for Amelia Hart",
      })
      const row = screen.getByRole("button", { name: "Amelia Hart" })
      expect(row).not.toContainElement(more)
      expect(more).toBeVisible()
    })

    it("runs the actions without any swipe", async () => {
      const user = userEvent.setup()
      const onArchive = vi.fn()
      const onDelete = vi.fn()
      render(
        <ListRow
          title="Amelia Hart"
          actionsLabel="Actions for Amelia Hart"
          swipeActions={actions(onArchive, onDelete)}
        />
      )
      await user.click(
        screen.getByRole("button", { name: "Actions for Amelia Hart" })
      )
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }))
      expect(onDelete).toHaveBeenCalledOnce()
      expect(onArchive).not.toHaveBeenCalled()
    })

    it("is reachable by keyboard: Tab, Enter, arrows, Enter", async () => {
      const user = userEvent.setup()
      const onArchive = vi.fn()
      render(
        <ListRow
          title="Amelia Hart"
          actionsLabel="Actions for Amelia Hart"
          swipeActions={actions(onArchive)}
        />
      )
      await user.tab() // the row
      expect(screen.getByRole("button", { name: "Amelia Hart" })).toHaveFocus()
      await user.tab() // the swipe actions are inert: next stop is the button
      const more = screen.getByRole("button", {
        name: "Actions for Amelia Hart",
      })
      expect(more).toHaveFocus()
      await user.keyboard("{Enter}")
      const archive = await screen.findByRole("menuitem", { name: "Archive" })
      expect(archive).toBeVisible()
      // Arrow keys move through the menu; Enter runs the focused item.
      await user.keyboard("{ArrowDown}")
      expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus()
      await user.keyboard("{ArrowUp}")
      expect(archive).toHaveFocus()
      await user.keyboard("{Enter}")
      expect(onArchive).toHaveBeenCalledOnce()
    })

    it("lists a danger action as a destructive menu item", async () => {
      const user = userEvent.setup()
      render(
        <ListRow
          title="Amelia Hart"
          actionsLabel="Actions for Amelia Hart"
          swipeActions={actions()}
        />
      )
      await user.click(
        screen.getByRole("button", { name: "Actions for Amelia Hart" })
      )
      expect(
        await screen.findByRole("menuitem", { name: "Delete" })
      ).toHaveAttribute("data-variant", "destructive")
    })
  })

  it("is dropped inside a listbox, which owns only options", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    render(
      <ListRows listbox aria-label="Reviews">
        <ListRow title="Amelia Hart" swipeActions={actions()} />
      </ListRows>
    )
    expect(
      document.querySelector('[data-slot="list-row-swipe"]')
    ).not.toBeInTheDocument()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
