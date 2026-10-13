import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
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

  it("keeps a shown policy face, and only it, through portrait and back", () => {
    // A phone turned from landscape (above md) to portrait and back: no
    // navigation, so no leave guard; the form must keep its input, and the
    // page must keep exactly one face and one h1 in every state.
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
    function Policy() {
      const [value, setValue] = React.useState("")
      return (
        <>
          <h1>Reply policy</h1>
          <input
            aria-label="Draft"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </>
      )
    }
    render(<SettingsHome index={<h1>Settings</h1>} policy={<Policy />} />)
    const draft = screen.getByLabelText<HTMLInputElement>("Draft")
    fireEvent.change(draft, { target: { value: "unsaved" } })

    const expectOnlyPolicy = () => {
      expect(document.querySelectorAll("h1")).toHaveLength(1)
      expect(
        screen.getByRole("heading", { level: 1, name: "Reply policy" })
      ).toBeInTheDocument()
      expect(document.querySelector("[data-slot=settings-index]")).toBeNull()
      // The same input, with its value: nothing remounted.
      expect(screen.getByLabelText<HTMLInputElement>("Draft")).toBe(draft)
      expect(draft.value).toBe("unsaved")
      // Never hidden by CSS once the width is known.
      expect(
        draft.closest("[data-slot=settings-home-policy]")?.className
      ).not.toMatch(/hidden/)
    }
    expectOnlyPolicy()
    wide = false
    act(() => listeners.forEach((fn) => fn()))
    expectOnlyPolicy()
    wide = true
    act(() => listeners.forEach((fn) => fn()))
    expectOnlyPolicy()
  })
})
