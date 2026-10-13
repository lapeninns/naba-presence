import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  BREAKPOINTS,
  CONTROLS_MIN_HEIGHT,
  MEDIA_QUERIES,
  type BreakpointName,
} from "@/lib/ui/breakpoints"

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8")

const globals = read("../app/globals.css")
const tailwindTheme = read("../node_modules/tailwindcss/theme.css")

/** Every `--breakpoint-<name>: <n>rem|px` declaration in a stylesheet, in rem. */
function breakpointDeclarations(css: string): Map<string, number> {
  const found = new Map<string, number>()
  for (const match of css.matchAll(
    /--breakpoint-([\w-]+)\s*:\s*([\d.]+)(rem|px)\s*;/g
  )) {
    const [, name, value, unit] = match
    found.set(name, unit === "px" ? Number(value) / 16 : Number(value))
  }
  return found
}

/** The media query inside `@custom-variant <name> (@media …);`. */
function customVariantMedia(name: string): string | undefined {
  const match = globals.match(
    new RegExp(
      `@custom-variant\\s+${name}\\s*\\(\\s*@media\\s+([^;]+?)\\s*\\)\\s*;`
    )
  )
  return match?.[1].replace(/\s+/g, " ")
}

const ownBreakpoints = breakpointDeclarations(globals)
const defaultBreakpoints = breakpointDeclarations(tailwindTheme)

describe("breakpoints mirror app/globals.css", () => {
  it.each(["sm", "md", "lg", "xl", "2xl"] as const)(
    "%s matches @theme, or Tailwind's default when globals.css sets none",
    (name) => {
      const expected = ownBreakpoints.get(name) ?? defaultBreakpoints.get(name)
      expect(expected).toBeDefined()
      expect(BREAKPOINTS[name].rem).toBe(expected)
      expect(BREAKPOINTS[name].px).toBe(expected! * 16)
    }
  )

  it("wide matches the --breakpoint-wide token in @theme", () => {
    const declared = ownBreakpoints.get("wide")
    expect(declared).toBeDefined()
    expect(BREAKPOINTS.wide.rem).toBe(declared)
  })

  it("desk is the custom variant's media query", () => {
    expect(customVariantMedia("desk")).toBe(MEDIA_QUERIES.desk)
  })

  it("controls is the variant's media query, and capsules its exact negation", () => {
    const controls = customVariantMedia("controls")
    const capsules = customVariantMedia("capsules")
    expect(controls).toBeDefined()
    expect(capsules).toBe(`not all and ${controls}`)

    const [, width, height] =
      controls!.match(
        /^\(min-width: ([\d.]+)rem\) and \(min-height: ([\d.]+)rem\)$/
      ) ?? []
    expect(Number(width)).toBe(BREAKPOINTS.md.rem)
    expect(Number(height)).toBe(CONTROLS_MIN_HEIGHT.rem)

    expect(MEDIA_QUERIES.controls).toBe(controls)
    expect(MEDIA_QUERIES.capsules).toBe(capsules)
  })

  it("names a min-width query for every breakpoint", () => {
    for (const name of Object.keys(BREAKPOINTS) as BreakpointName[]) {
      expect(MEDIA_QUERIES[name]).toBe(
        `(min-width: ${BREAKPOINTS[name].rem}rem)`
      )
    }
  })
})
