import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AppearanceRow } from "@/components/settings/appearance"

const theme = vi.hoisted(() => ({ current: "system", set: vi.fn() }))
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: theme.current, setTheme: theme.set }),
}))

beforeEach(() => {
  theme.current = "system"
  theme.set.mockReset()
})

// SET-26: the theme is in Settings as well as More.
describe("AppearanceRow", () => {
  it("shows the current theme and opens a titled sheet of the three", async () => {
    theme.current = "dark"
    render(<AppearanceRow />)
    const row = screen.getByRole("button", { name: /Appearance/ })
    expect(row).toHaveTextContent("Dark")
    await userEvent.click(row)
    const sheet = within(screen.getByRole("dialog", { name: "Appearance" }))
    const choices = sheet.getAllByRole("option")
    expect(choices.map((choice) => choice.textContent)).toEqual([
      "Light",
      "Dark",
      "Match system",
    ])
    expect(sheet.getByRole("option", { name: "Dark" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
  })

  it("applies a choice and closes the sheet", async () => {
    render(<AppearanceRow />)
    await userEvent.click(screen.getByRole("button", { name: /Appearance/ }))
    await userEvent.click(screen.getByRole("option", { name: "Light" }))
    expect(theme.set).toHaveBeenCalledWith("light")
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Appearance" })
      ).not.toBeInTheDocument()
    )
  })

  it("moves with the arrows and applies only on Enter", async () => {
    // Choosing closes the sheet, so an arrow that chose would apply a theme
    // and lose the picker on the first key press.
    const user = userEvent.setup()
    theme.current = "light"
    render(<AppearanceRow />)
    await user.click(screen.getByRole("button", { name: /Appearance/ }))
    const sheet = within(screen.getByRole("dialog", { name: "Appearance" }))
    sheet.getByRole("option", { name: "Light" }).focus()
    await user.keyboard("{ArrowDown}")
    expect(sheet.getByRole("option", { name: "Dark" })).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(sheet.getByRole("option", { name: "Match system" })).toHaveFocus()
    expect(theme.set).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog", { name: "Appearance" })).toBeInTheDocument()
    await user.keyboard("{Enter}")
    expect(theme.set).toHaveBeenCalledWith("system")
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Appearance" })
      ).not.toBeInTheDocument()
    )
  })
})
