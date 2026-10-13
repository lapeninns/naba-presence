import { cleanup, render, screen } from "@testing-library/react"
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
})
