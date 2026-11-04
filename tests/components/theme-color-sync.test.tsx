import { fireEvent, render, screen } from "@testing-library/react"
import { useTheme } from "next-themes"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { THEME_COLOR, themeColorFor } from "@/lib/ui/theme-color"

function metas() {
  return [
    ...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
  ]
}

function Picker() {
  const { setTheme } = useTheme()
  return (
    <>
      {["light", "dark", "system"].map((theme) => (
        <button key={theme} type="button" onClick={() => setTheme(theme)}>
          {theme}
        </button>
      ))}
    </>
  )
}
const pick = (theme: string) =>
  fireEvent.click(screen.getByRole("button", { name: theme }))

describe("theme-color follows the in-app theme choice (R59)", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }))
    )
    for (const [media, color] of [
      ["(prefers-color-scheme: light)", THEME_COLOR.light],
      ["(prefers-color-scheme: dark)", THEME_COLOR.dark],
    ]) {
      const meta = document.createElement("meta")
      meta.name = "theme-color"
      meta.setAttribute("media", media)
      meta.content = color
      document.head.append(meta)
    }
  })
  afterEach(() => {
    for (const meta of metas()) meta.remove()
    vi.unstubAllGlobals()
    document.documentElement.className = ""
  })

  it("maps each media to its own colour while matching the system", () => {
    expect(themeColorFor("(prefers-color-scheme: light)", null)).toBe(
      THEME_COLOR.light
    )
    expect(themeColorFor("(prefers-color-scheme: dark)", null)).toBe(
      THEME_COLOR.dark
    )
    expect(themeColorFor("(prefers-color-scheme: light)", "dark")).toBe(
      THEME_COLOR.dark
    )
  })

  it("repoints both metas on a mid-session switch and restores them for system", () => {
    render(
      <ThemeProvider>
        <Picker />
      </ThemeProvider>
    )
    expect(metas().map((m) => m.content)).toEqual([
      THEME_COLOR.light,
      THEME_COLOR.dark,
    ])

    pick("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(metas().map((m) => m.content)).toEqual([
      THEME_COLOR.dark,
      THEME_COLOR.dark,
    ])

    pick("light")
    expect(metas().map((m) => m.content)).toEqual([
      THEME_COLOR.light,
      THEME_COLOR.light,
    ])

    pick("system")
    expect(metas().map((m) => m.content)).toEqual([
      THEME_COLOR.light,
      THEME_COLOR.dark,
    ])
  })
})
