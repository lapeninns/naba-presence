import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Pagination } from "@/components/ui/pagination"

const LISTINGS = ["listing", "listings"] as const

describe("Pagination", () => {
  it("is a named nav with the status line and Previous/Next", () => {
    render(
      <Pagination
        shown={5}
        total={9}
        noun={LISTINGS}
        sortLabel="name"
        page={1}
        pageCount={2}
        onPageChange={() => {}}
      />
    )
    const nav = screen.getByRole("navigation", { name: "Pagination" })
    const status = within(nav).getByText(
      "Showing 5 of 9 listings · sorted by name"
    )
    expect(status).toHaveClass("tabular-nums")
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(
      within(nav).getByRole("button", { name: "Previous page" })
    ).toBeInTheDocument()
    expect(
      within(nav).getByRole("button", { name: "Next page" })
    ).toBeInTheDocument()
  })

  it("says all of them on one page, and takes a formatter for the noun", () => {
    render(
      <Pagination
        shown={1}
        total={1}
        noun={(total) => (total === 1 ? "person" : "people")}
        page={1}
        pageCount={1}
        onPageChange={() => {}}
      />
    )
    expect(screen.getByText("Showing all 1 person")).toBeInTheDocument()
  })

  it("draws the end buttons disabled with a reason, never faded", async () => {
    const onPageChange = vi.fn()
    const { rerender } = render(
      <Pagination
        shown={5}
        total={9}
        noun={LISTINGS}
        page={1}
        pageCount={2}
        onPageChange={onPageChange}
      />
    )
    const previous = screen.getByRole("button", { name: "Previous page" })
    expect(previous).toHaveAttribute("aria-disabled", "true")
    expect(previous).toHaveAccessibleDescription("This is the first page")
    expect(previous.className).not.toMatch(/opacity/)
    expect(previous).toHaveAttribute("data-variant", "secondary")
    expect(previous).toHaveAttribute("data-size", "sm")
    await userEvent.click(previous)
    expect(onPageChange).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(onPageChange).toHaveBeenCalledWith(2)

    rerender(
      <Pagination
        shown={4}
        total={9}
        noun={LISTINGS}
        page={2}
        pageCount={2}
        onPageChange={onPageChange}
      />
    )
    expect(
      screen.getByRole("button", { name: "Next page" })
    ).toHaveAccessibleDescription("This is the last page")
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }))
    expect(onPageChange).toHaveBeenLastCalledWith(1)
  })

  it("shows page numbers only when asked and past five pages, hidden below md", async () => {
    const onPageChange = vi.fn()
    const { rerender } = render(
      <Pagination
        shown={10}
        total={50}
        noun={LISTINGS}
        page={3}
        pageCount={5}
        pageNumbers
        onPageChange={onPageChange}
      />
    )
    expect(screen.queryByRole("button", { name: "Page 1" })).toBeNull()

    rerender(
      <Pagination
        shown={10}
        total={400}
        noun={LISTINGS}
        page={7}
        pageCount={40}
        pageNumbers
        onPageChange={onPageChange}
      />
    )
    const pages = document.querySelector('[data-slot="pagination-pages"]')!
    expect(pages).toHaveClass("hidden", "md:flex")
    const names = within(pages as HTMLElement)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))
    expect(names).toEqual(["Page 1", "Page 6", "Page 7", "Page 8", "Page 40"])
    const current = screen.getByRole("button", { name: "Page 7" })
    expect(current).toHaveAttribute("aria-current", "page")
    expect(current).toHaveClass("bg-fill", "font-semibold", "tabular-nums")
    await userEvent.click(screen.getByRole("button", { name: "Page 40" }))
    expect(onPageChange).toHaveBeenCalledWith(40)
  })

  it("never shows page numbers unless the caller opts in", () => {
    render(
      <Pagination
        shown={10}
        total={400}
        noun={LISTINGS}
        page={7}
        pageCount={40}
        onPageChange={() => {}}
      />
    )
    expect(document.querySelector('[data-slot="pagination-pages"]')).toBeNull()
  })

  it("announces every page turn, even when the count is unchanged", () => {
    const props = {
      shown: 5,
      total: 15,
      noun: LISTINGS,
      pageCount: 3,
      onPageChange: () => {},
    }
    const { rerender } = render(<Pagination {...props} page={1} />)
    const status = document.querySelector('[data-slot="pagination-status"]')
    expect(status).toHaveTextContent("Showing 5 of 15 listings · page 1 of 3")
    rerender(<Pagination {...props} page={2} />)
    expect(status).toHaveTextContent("Showing 5 of 15 listings · page 2 of 3")
  })

  it("clamps an out-of-range page to the pages there are", async () => {
    const onPageChange = vi.fn()
    const props = {
      shown: 5,
      total: 9,
      noun: LISTINGS,
      pageCount: 2,
      onPageChange,
    }
    const { rerender } = render(<Pagination {...props} page={5} />)
    const status = document.querySelector('[data-slot="pagination-status"]')
    expect(status).toHaveTextContent("page 2 of 2")
    const next = screen.getByRole("button", { name: "Next page" })
    expect(next).toHaveAccessibleDescription("This is the last page")
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Previous page" }))
    expect(onPageChange).toHaveBeenCalledWith(1)

    rerender(<Pagination {...props} page={0} pageCount={0} />)
    expect(status).toHaveTextContent("page 1 of 1")
  })

  it("takes its own name when a view has two pagers", () => {
    render(
      <Pagination
        shown={5}
        total={9}
        noun={LISTINGS}
        page={1}
        pageCount={2}
        onPageChange={() => {}}
        aria-label="Reviews pages"
      />
    )
    expect(
      screen.getByRole("navigation", { name: "Reviews pages" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull()
  })
})
