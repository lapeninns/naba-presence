import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ListRow, ListRowTag, ListRows } from "@/components/ui/list-row"

describe("ListRow", () => {
  it("renders every slot inside one button that is the whole row", () => {
    render(
      <ListRow
        leading={<span>AH</span>}
        title="Amelia Hart"
        meta="9:10"
        subtitle="2★ · The Old Crown"
        trailing={<span>Needs reply</span>}
        preview="We waited forty minutes."
        tags={<ListRowTag tone="green">Food</ListRowTag>}
      />
    )
    const row = screen.getByRole("button")
    for (const text of [
      "AH",
      "Amelia Hart",
      "9:10",
      "2★ · The Old Crown",
      "Needs reply",
      "We waited forty minutes.",
      "Food",
    ])
      expect(within(row).getByText(text)).toBeInTheDocument()
    expect(row).toHaveAttribute("type", "button")
    // The 44px floor and the mail-row padding are tokens.
    expect(row.className).toContain("min-h-(--np-touch)")
    expect(row.className).toContain("py-(--np-row-mail-py)")
    expect(row.className).toContain("hover-fine:hover:bg-surface-alt")
    // Focus is an inset ring, which a scrolling list cannot clip.
    expect(row.className).toContain("focus-visible:ring-inset")
  })

  it("marks unread with weight, a dot and an sr-only word", () => {
    render(
      <ListRow
        title="Amelia Hart"
        emphasis="unread"
        unreadLabel="Needs reply"
      />
    )
    const row = screen.getByRole("button", { name: /Amelia Hart, Needs reply/ })
    const title = row.querySelector('[data-slot="list-row-title"]')!
    expect(title.className).toContain("font-semibold")
    expect(title.className).toContain("text-ink")
    const dot = row.querySelector('[data-slot="list-row-unread-dot"]')!
    expect(dot).toHaveAttribute("aria-hidden", "true")
    expect(dot.className).toContain("bg-indicator-unread")
  })

  it("defaults the unread word to Unread", () => {
    render(<ListRow title="Tom" emphasis="unread" />)
    expect(
      screen.getByRole("button", { name: /Tom, Unread/ })
    ).toBeInTheDocument()
  })

  it("draws read rows regular and secondary, with no dot", () => {
    render(<ListRow title="Tom Price" />)
    const row = screen.getByRole("button", { name: "Tom Price" })
    const title = row.querySelector('[data-slot="list-row-title"]')!
    expect(title.className).toContain("font-normal")
    expect(title.className).toContain("text-ink-secondary")
    expect(row.querySelector('[data-slot="list-row-unread-dot"]')).toBeNull()
  })

  it("activates with a click, Enter and Space", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<ListRow title="Tom Price" onClick={onClick} />)
    const row = screen.getByRole("button", { name: "Tom Price" })
    await user.click(row)
    row.focus()
    await user.keyboard("{Enter}")
    await user.keyboard(" ")
    expect(onClick).toHaveBeenCalledTimes(3)
  })

  it("announces selection with aria-current and drops the divider", () => {
    render(
      <ListRows aria-label="Reviews">
        <ListRow title="One" selected />
        <ListRow title="Two" />
      </ListRows>
    )
    const one = screen.getByRole("button", { name: "One" })
    expect(one).toHaveAttribute("aria-current", "true")
    expect(one.className).toContain("bg-fill")
    expect(screen.getByRole("button", { name: "Two" })).not.toHaveAttribute(
      "aria-current"
    )
    const items = within(
      screen.getByRole("list", { name: "Reviews" })
    ).getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveAttribute("data-selected")
    expect(items[0].className).toContain("data-selected:after:hidden")
    expect(items[1].className).toContain("last:after:hidden")
  })

  it("can announce selection with aria-selected", () => {
    render(<ListRow title="One" selected selectedAs="selected" role="option" />)
    expect(screen.getByRole("option", { name: "One" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
  })

  it("renders as a link with href", () => {
    render(<ListRow title="Priya" href="/inbox/3" selected />)
    const link = screen.getByRole("link", { name: "Priya" })
    expect(link).toHaveAttribute("href", "/inbox/3")
    expect(link).toHaveAttribute("aria-current", "page")
    expect(link).not.toHaveAttribute("type")
  })

  it("renders a custom element via render", () => {
    render(<ListRow title="Custom" render={<a href="/x" />} />)
    expect(screen.getByRole("link", { name: "Custom" })).toHaveAttribute(
      "href",
      "/x"
    )
  })

  it("is a plain box when not interactive", () => {
    render(
      <ListRow
        interactive={false}
        title="Summary"
        trailing={<button type="button">Open</button>}
      />
    )
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument()
  })

  it("keeps a leading control outside the row's hit element", async () => {
    const user = userEvent.setup()
    const onRow = vi.fn()
    const onCheck = vi.fn()
    render(
      <ListRow
        title="Amelia"
        onClick={onRow}
        leadingControl={
          <input
            type="checkbox"
            aria-label="Select Amelia"
            onChange={onCheck}
          />
        }
      />
    )
    await user.click(screen.getByRole("checkbox", { name: "Select Amelia" }))
    expect(onCheck).toHaveBeenCalled()
    expect(onRow).not.toHaveBeenCalled()
    expect(
      within(screen.getByRole("button", { name: "Amelia" })).queryByRole(
        "checkbox"
      )
    ).toBeNull()
  })

  it("bleeds to the screen edge on a phone", () => {
    render(
      <ListRows bleed aria-label="Rows">
        <ListRow title="One" />
      </ListRows>
    )
    expect(screen.getByRole("list", { name: "Rows" }).className).toContain(
      "max-md:-mx-(--np-page-pad-x)"
    )
  })

  it("insets the divider to the text column", () => {
    const { container } = render(<ListRow leading={<span />} title="One" />)
    const wrapper = container.querySelector('[data-slot="list-row"]')!
    expect(wrapper.className).toContain("after:start-(--np-row-inset-start)")
    expect(wrapper.className).toContain("after:bg-line-subtle")
  })

  it("draws footer actions under the preview, outside the row's hit element", async () => {
    const user = userEvent.setup()
    const onRow = vi.fn()
    const onAccept = vi.fn()
    render(
      <ListRows aria-label="Suggestions">
        <ListRow
          leading={<span>G</span>}
          title="Google suggested new hours"
          preview="Mon–Fri 11:00–23:00"
          onClick={onRow}
          footer={
            <>
              <button type="button" onClick={onAccept}>
                Accept
              </button>
              <button type="button">Ignore</button>
            </>
          }
        />
      </ListRows>
    )
    const row = screen.getByRole("button", { name: /Google suggested/ })
    // No button inside a button: the actions are siblings of the hit element.
    expect(within(row).queryByRole("button")).toBeNull()
    const accept = screen.getByRole("button", { name: "Accept" })
    const footer = accept.closest('[data-slot="list-row-footer"]')!
    expect(footer.parentElement).toBe(row.parentElement)
    expect(
      row.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    // Aligned to the text column.
    expect(footer.className).toContain("ps-(--np-row-inset-start)")
    await user.click(accept)
    expect(onAccept).toHaveBeenCalledOnce()
    expect(onRow).not.toHaveBeenCalled()
    expect(screen.getByRole("listitem")).toContainElement(accept)
  })

  it('renders an li outside ListRows with as="li"', () => {
    render(
      <ul aria-label="Mine">
        <ListRow as="li" title="One" />
      </ul>
    )
    expect(
      within(screen.getByRole("list", { name: "Mine" })).getAllByRole(
        "listitem"
      )
    ).toHaveLength(1)
  })

  it("draws tags from the decorative tag ramp", () => {
    render(<ListRowTag tone="purple">Staff</ListRowTag>)
    const tag = screen.getByText("Staff")
    expect(tag.className).toContain("bg-tag-purple-bg")
    expect(tag.className).toContain("text-tag-purple-ink")
  })
})
