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
    const choices = sheet.getAllByRole("radio")
    expect(choices.map((choice) => choice.textContent)).toEqual([
      "Light",
      "Dark",
      "Match system",
    ])
    expect(sheet.getByRole("radio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
  })

  it("applies a choice and closes the sheet", async () => {
    render(<AppearanceRow />)
    await userEvent.click(screen.getByRole("button", { name: /Appearance/ }))
    await userEvent.click(screen.getByRole("radio", { name: "Light" }))
    expect(theme.set).toHaveBeenCalledWith("light")
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Appearance" })
      ).not.toBeInTheDocument()
    )
  })
})
