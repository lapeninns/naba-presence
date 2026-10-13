import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  ACCESS_SEARCH_THRESHOLD,
  AccessScopeForm,
  firstName,
  type AccessScopeItem,
} from "@/components/settings/access-scope-form"

function items(count: number): AccessScopeItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    name: `Client ${index}`,
    checked: false,
  }))
}

function renderForm(
  overrides: Partial<React.ComponentProps<typeof AccessScopeForm>> = {}
) {
  const props: React.ComponentProps<typeof AccessScopeForm> = {
    noun: { one: "client", many: "clients" },
    legend: "Which clients Ben can see",
    mode: "some",
    onModeChange: vi.fn(),
    allOption: { title: "All clients", description: "Including later ones." },
    someOption: { title: "Only these clients", description: "Ticked ones." },
    items: items(2),
    emptyMessage: "There are no clients yet.",
    onToggle: vi.fn(),
    ...overrides,
  }
  render(<AccessScopeForm {...props} />)
  return props
}

describe("firstName", () => {
  it("takes the first word, or the whole name when there is none", () => {
    expect(firstName("Ben Member")).toBe("Ben")
    expect(firstName("  Ana  ")).toBe("Ana")
    expect(firstName("")).toBe("")
  })
})

describe("AccessScopeForm", () => {
  it("names the choice and reports a mode change", async () => {
    const user = userEvent.setup()
    const props = renderForm({ mode: "all" })
    const group = screen.getByRole("radiogroup", {
      name: "Which clients Ben can see",
    })
    expect(group).toBeInTheDocument()
    // No checklist while "All" is chosen.
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
    await user.click(screen.getByRole("radio", { name: /Only these clients/ }))
    expect(props.onModeChange).toHaveBeenCalledWith("some")
  })

  it("lists the items and reports a toggle", async () => {
    const user = userEvent.setup()
    const props = renderForm()
    expect(screen.getByRole("list", { name: "Clients" })).toBeInTheDocument()
    await user.click(screen.getByRole("checkbox", { name: /Client 1/ }))
    expect(props.onToggle).toHaveBeenCalledWith("c1", true)
  })

  it("has no search box at or under the threshold", () => {
    renderForm({ items: items(ACCESS_SEARCH_THRESHOLD) })
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
  })

  it("filters a long list by name and says when nothing matches", async () => {
    const user = userEvent.setup()
    renderForm({ items: items(ACCESS_SEARCH_THRESHOLD + 1) })
    const search = screen.getByRole("searchbox", { name: "Search clients" })
    await user.type(search, "Client 3")
    expect(screen.getAllByRole("checkbox")).toHaveLength(1)
    await user.clear(search)
    await user.type(search, "zzz")
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
    expect(screen.getByText(/No clients match/)).toBeInTheDocument()
  })

  it("shows a per-row publish switch named for the item", async () => {
    const user = userEvent.setup()
    const onPublishChange = vi.fn()
    renderForm({
      items: [
        {
          id: "c1",
          name: "Old Crown",
          checked: true,
          publish: { checked: false, label: "Can publish" },
        },
      ],
      onPublishChange,
    })
    await user.click(
      screen.getByRole("switch", { name: "Can publish to Old Crown" })
    )
    expect(onPublishChange).toHaveBeenCalledWith("c1", true)
  })

  it("shows the empty message instead of an empty list", () => {
    renderForm({ items: [] })
    expect(screen.getByText("There are no clients yet.")).toBeInTheDocument()
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
  })

  it("ties a selection error to the list", () => {
    renderForm({ error: "Tick at least one client." })
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Tick at least one client.")
    expect(screen.getByRole("list", { name: "Clients" })).toHaveAttribute(
      "aria-describedby",
      alert.id
    )
  })
})
