import { readdirSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

import {
  contextOptions,
  DEFAULT_ROUTES,
  dirFor,
  nameOf,
  parseSize,
  parseSpec,
  resolveThemes,
  resolveViewports,
  ROLES,
  stateRunsOn,
  templateOf,
} from "./nm-capture-lib.mjs"

describe("resolveViewports", () => {
  it("defaults to the original desktop and mobile pair", () => {
    const viewports = resolveViewports({})
    expect(viewports.map((viewport) => viewport.name)).toEqual([
      "desktop",
      "mobile",
    ])
    expect(viewports[0].context).toEqual({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    })
    expect(viewports[1].context).toEqual({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    })
  })

  it("resolves the phone, tablet and desktop presets", () => {
    const viewports = resolveViewports({
      viewports: "phone,tablet,desktop",
    })
    expect(
      viewports.map(({ name, width, height, input }) => [
        name,
        width,
        height,
        input,
      ])
    ).toEqual([
      ["phone", 390, 844, "touch"],
      ["tablet", 834, 1194, "touch"],
      ["desktop", 1440, 900, "mouse"],
    ])
    expect(viewports[1].context.hasTouch).toBe(true)
  })

  it("adds --sizes after presets and drops duplicates", () => {
    const viewports = resolveViewports({
      viewports: "desktop",
      sizes: "320x568, 1024x768:touch,320x568",
    })
    expect(viewports.map((viewport) => viewport.name)).toEqual([
      "desktop",
      "w320x568",
      "w1024x768-touch",
    ])
  })

  it("uses only --sizes when no presets are named", () => {
    expect(
      resolveViewports({ sizes: "844x390" }).map((viewport) => viewport.name)
    ).toEqual(["w844x390"])
  })

  it("applies the DPR flags by input type", () => {
    const [phone, desktop] = resolveViewports({
      viewports: "phone,desktop",
      dpr: { mobile: "2", desktop: "2" },
    })
    expect(phone.context.deviceScaleFactor).toBe(2)
    expect(desktop.context.deviceScaleFactor).toBe(2)
  })

  it("rejects unknown presets", () => {
    expect(() => resolveViewports({ viewports: "watch" })).toThrow(
      /Unknown viewport "watch"/
    )
  })
})

describe("parseSize", () => {
  it("infers touch below 1024 wide and mouse at or above", () => {
    expect(parseSize("1023x768")).toMatchObject({
      input: "touch",
      layouts: ["mobile"],
    })
    expect(parseSize("1024x768")).toMatchObject({
      input: "mouse",
      layouts: ["desktop"],
    })
  })

  it("honours an explicit input", () => {
    expect(parseSize("1280x800:touch")).toMatchObject({
      name: "w1280x800-touch",
      input: "touch",
    })
    expect(parseSize("600x900:mouse")).toMatchObject({
      name: "w600x900-mouse",
      input: "mouse",
    })
  })

  it("rejects malformed sizes", () => {
    for (const bad of ["320", "320x", "x568", "320x568:pen", "big"]) {
      expect(() => parseSize(bad)).toThrow(/Bad size/)
    }
  })
})

describe("contextOptions", () => {
  it("leaves touch flags off mouse viewports", () => {
    expect(
      contextOptions({ width: 1280, height: 800, input: "mouse" })
    ).toEqual({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  })
})

describe("stateRunsOn", () => {
  const [phone, tablet, desktop] = resolveViewports({
    viewports: "phone,tablet,desktop",
  })

  it("runs unrestricted states everywhere", () => {
    expect(stateRunsOn(null, phone)).toBe(true)
  })

  it("keeps layout-specific states to matching viewports", () => {
    expect(stateRunsOn(["mobile"], phone)).toBe(true)
    expect(stateRunsOn(["mobile"], desktop)).toBe(false)
    expect(stateRunsOn(["desktop"], phone)).toBe(false)
    expect(stateRunsOn(["desktop"], tablet)).toBe(true)
    expect(stateRunsOn(["mobile"], tablet)).toBe(true)
  })
})

describe("resolveThemes", () => {
  it("keeps --dark as light and dark", () => {
    expect(resolveThemes({})).toEqual(["light"])
    expect(resolveThemes({ dark: true })).toEqual(["light", "dark"])
  })

  it("reads --themes, which wins over --dark", () => {
    expect(resolveThemes({ themes: "dark", dark: true })).toEqual(["dark"])
    expect(() => resolveThemes({ themes: "sepia" })).toThrow(/Unknown theme/)
  })
})

describe("names and specs", () => {
  it("names output dirs by theme", () => {
    expect(dirFor("tablet", "light")).toBe("tablet")
    expect(dirFor("phone", "dark")).toBe("phone-dark")
  })

  it("parses role-prefixed specs and names shots", () => {
    expect(parseSpec("viewer:/team")).toEqual({ role: "viewer", path: "/team" })
    expect(parseSpec(" /inbox ")).toEqual({ role: "owner", path: "/inbox" })
    expect(nameOf("owner", "/listings/{loc}/profile")).toBe(
      "listings-loc-profile"
    )
    expect(nameOf("anon", "/")).toBe("anon--root")
  })
})

describe("templateOf", () => {
  it("turns placeholders, invalid tokens and uuids into params", () => {
    expect(templateOf("/listings/{loc}/hours")).toBe("/listings/[]/hours")
    expect(templateOf("/invite/nm-capture-invalid-token")).toBe("/invite/[]")
    expect(
      templateOf("/listings/bulk/00000000-0000-4000-8000-000000000000")
    ).toBe("/listings/bulk/[]")
    expect(templateOf("/sign-in?mode=create-account")).toBe("/sign-in")
    expect(templateOf("/")).toBe("/")
  })
})

describe("DEFAULT_ROUTES", () => {
  const appDir = join(import.meta.dirname, "../../app")
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name))
        : [relative(appDir, join(dir, entry.name))]
    )
  // Pages and user-facing route handlers (app/api is not a screen).
  const routes = walk(appDir)
    .filter((file) => !file.startsWith("api/"))
    .filter((file) => /(^|\/)(page\.tsx|route\.ts)$/.test(file))
    .map((file) => {
      const segments = file
        .split("/")
        .slice(0, -1)
        .filter((segment) => !/^\(.+\)$/.test(segment))
      return { file, segments }
    })
  const captured = DEFAULT_ROUTES.map((spec) =>
    templateOf(parseSpec(spec).path).split("/").filter(Boolean)
  )
  const reaches = (segments: string[], path: string[]): boolean => {
    if (segments.at(-1)?.startsWith("[...")) {
      const head = segments.slice(0, -1)
      return (
        path.length > head.length &&
        head.every((segment, index) => reaches([segment], [path[index]]))
      )
    }
    return (
      segments.length === path.length &&
      segments.every((segment, index) =>
        segment.startsWith("[") ? path[index] === "[]" : segment === path[index]
      )
    )
  }

  it("reaches every page and user-facing route handler under app/", () => {
    expect(routes.length).toBeGreaterThan(50)
    const missing = routes
      .filter(
        ({ segments }) => !captured.some((path) => reaches(segments, path))
      )
      .map(({ file }) => file)
    expect(missing).toEqual([])
  })

  it("names only roles nm-capture has cookies for, with unique shot names", () => {
    const specs = DEFAULT_ROUTES.map(parseSpec)
    expect(specs.filter(({ role }) => !ROLES.includes(role))).toEqual([])
    const names = specs.map(({ role, path }) => nameOf(role, path))
    expect(
      names.filter((name, index) => names.indexOf(name) !== index)
    ).toEqual([])
  })
})
