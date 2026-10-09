import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TimezonePicker } from "@/components/settings/timezone-picker"
import { languageLabel, languageOptionsFor } from "@/lib/settings/languages"
import { COMMON_TIMEZONES, timezoneLabel } from "@/lib/settings/timezones"

describe("TimezonePicker", () => {
  it("lists common zones first and narrows the list as you type", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <TimezonePicker
        id="tz"
        aria-describedby="tz-hint"
        value="Europe/London"
        onChange={onChange}
      />
    )
    const input = screen.getByRole("combobox")
    expect(input).toHaveValue("Europe / London")
    await user.click(screen.getByRole("button", { name: "Show options" }))
    const options = await screen.findAllByRole("option")
    expect(options[0]).toHaveTextContent(timezoneLabel(COMMON_TIMEZONES[0]!))

    await user.clear(input)
    await user.type(input, "angel")
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "America / Los Angeles" })
      ).toBeInTheDocument()
    )
    expect(
      screen.queryByRole("option", { name: "Europe / London" })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("option", { name: "America / Los Angeles" }))
    expect(onChange).toHaveBeenCalledWith("America/Los_Angeles")
  })
})

describe("language options", () => {
  it("names known codes and keeps an unknown stored code selectable", () => {
    expect(languageLabel("en-GB")).toBe("English (UK)")
    const options = languageOptionsFor("ga")
    expect(options[0]).toEqual({ code: "ga", label: "Irish" })
  })
})
