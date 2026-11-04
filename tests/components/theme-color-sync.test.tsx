import { act, render } from "@testing-library/react"
import { useTheme } from "next-themes"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { THEME_COLOR, themeColorFor } from "@/lib/ui/theme-color"

function metas() {
  return [
    ...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
  ]
}

let setThemeRef: ((theme: string) => void) | null = null
function Grab() {
  setThemeRef = useTheme().setTheme
  return null
}

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
        <Grab />
      </ThemeProvider>
    )
    expect(metas().map((m) => m.content)).toEqual([
      THEME_COLOR.light,
      THEME_COLOR.dark,
    ])

    act(() => setThemeRef?.("dark"))
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(metas().map((m) => m.content)).toEqual([
      THEME_COLOR.dark,
      THEME_COLOR.dark,
    ])

    act(() => setThemeRef?.("light"))
    expect(metas().map((m) => m.content)).toEqual([
      THEME_COLOR.light,
      THEME_COLOR.light,
    ])

    act(() => setThemeRef?.("system"))
    expect(metas().map((m) => m.content)).toEqual([
      THEME_COLOR.light,
      THEME_COLOR.dark,
    ])
  })
})
