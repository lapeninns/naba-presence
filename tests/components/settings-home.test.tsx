import { act, cleanup, render, screen } from "@testing-library/react"
import * as React from "react"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SettingsHome } from "@/components/settings/settings-home"

function home() {
  return (
    <SettingsHome index={<h1>Settings</h1>} policy={<h1>Reply policy</h1>} />
  )
}

// Whether the viewport is at least md, as the shell's matchMedia answers.
function stubWidth(wide: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: wide,
      addEventListener: () => {},
      removeEventListener: () => {},
    })
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("SettingsHome", () => {
  it("draws both faces, each hidden by CSS at the other width, on the server", () => {
    // The first paint is right on every device before the client knows its
    // width, so neither face is dropped yet.
    const html = renderToString(home())
    expect(html).toContain("Settings</h1>")
    expect(html).toContain("Reply policy</h1>")
    expect(html).toMatch(/data-slot="settings-index"[^>]*md:hidden/)
    expect(html).toMatch(/data-slot="settings-home-policy"[^>]*max-md:hidden/)
  })

  it("keeps only the settings index, and one h1, on a phone", () => {
    stubWidth(false)
    render(home())
    expect(document.querySelectorAll("h1")).toHaveLength(1)
    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" })
    ).toBeInTheDocument()
  })

  it("keeps only Reply policy, and one h1, from md", () => {
    stubWidth(true)
    render(home())
    expect(document.querySelectorAll("h1")).toHaveLength(1)
    expect(
      screen.getByRole("heading", { level: 1, name: "Reply policy" })
    ).toBeInTheDocument()
  })

  it("keeps a policy face it has shown mounted when the viewport narrows", () => {
    // A phone turned from landscape (above md) to portrait: no navigation, so
    // no leave guard, and unmounting the form would drop unsaved edits.
    let wide = true
    const listeners = new Set<() => void>()
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        get matches() {
          return wide
        },
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) =>
          listeners.delete(fn),
      }))
    )
    function Draft() {
      const [value, setValue] = React.useState("")
      return (
        <input
          aria-label="Draft"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      )
    }
    render(<SettingsHome index={<h1>Settings</h1>} policy={<Draft />} />)
    const draft = screen.getByLabelText<HTMLInputElement>("Draft")
    act(() => {
      draft.value = "unsaved"
      draft.dispatchEvent(new Event("input", { bubbles: true }))
    })
    wide = false
    act(() => listeners.forEach((fn) => fn()))
    expect(screen.getByLabelText<HTMLInputElement>("Draft")).toBe(draft)
    expect(draft.closest("[data-slot=settings-home-policy]")).toHaveClass(
      "max-md:hidden"
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" })
    ).toBeInTheDocument()
  })
})
