import { describe, expect, it } from "vitest"

import {
  analyseClassToken,
  analyseString,
  compareToBaseline,
  exemptLines,
  findColourLiterals,
  hasLengthLiteral,
  isIgnoredPath,
  RULE_IDS,
  RULES,
  scanSource,
  splitVariants,
  summarise,
} from "../scripts/check-design.mjs"

type Finding = { file: string; rule: string; line: number; pattern: string }

const rulesOf = (token: string) => analyseClassToken(token).map((f) => f.rule)
const scan = (source: string, path = "components/feature/example.tsx") =>
  scanSource(source, path) as Finding[]
const rulesIn = (source: string, path?: string) =>
  scan(source, path).map((f) => f.rule)

describe("rule catalogue", () => {
  it("describes every rule with why and fix", () => {
    expect(RULE_IDS).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7"])
    for (const rule of Object.values(RULES)) {
      expect(
        rule.title && rule.description && rule.why && rule.fix
      ).toBeTruthy()
    }
  })
})

describe("token parsing", () => {
  it("splits variants only on top-level colons", () => {
    expect(splitVariants("md:[@media(min-height:620px)]:p-[3px]")).toEqual([
      "md",
      "[@media(min-height:620px)]",
      "p-[3px]",
    ])
  })

  it("treats viewport and percentage units as layout, not scale values", () => {
    expect(hasLengthLiteral("12px")).toBe(true)
    expect(hasLengthLiteral("min(20rem,var(--x))")).toBe(true)
    expect(
      hasLengthLiteral("calc(var(--np-toolbar-h)+var(--np-gap-card))")
    ).toBe(false)
    expect(hasLengthLiteral("100dvh")).toBe(false)
    expect(hasLengthLiteral("minmax(0,1fr)")).toBe(false)
  })
})

describe("R1 type sizes", () => {
  it.each([
    "text-[11.5px]",
    "text-[0.71875rem]",
    "text-[clamp(22px,1.1vw+15px,28px)]",
    "sm:text-[13px]",
    "leading-[18px]",
    "leading-[1.18]",
    "leading-5",
    "text-sm",
    "text-base",
    "md:text-2xl",
    "text-xs/5",
  ])("flags %s", (token) => {
    expect(rulesOf(token)).toEqual(["R1"])
  })

  it.each([
    "text-caption",
    "text-ui",
    "text-body",
    "text-page-title",
    "text-reading",
    "text-ink-muted",
    "leading-none",
    "leading-[var(--text-body--line-height)]",
    "text-[length:var(--np-x)]",
    "text-(--np-x)",
  ])("allows %s", (token) => {
    expect(rulesOf(token)).toEqual([])
  })

  it("flags inline fontSize and lineHeight", () => {
    const findings = scan(`<p style={{ fontSize: 12, lineHeight: "1.2" }} />`)
    expect(
      findings.filter((f) => f.rule === "R1").map((f) => f.pattern)
    ).toEqual(["style.fontSize", "style.lineHeight"])
  })
})

describe("R2 literal colours", () => {
  it.each([
    "bg-[#fff]",
    "text-[oklch(0.5_0.1_240)]",
    "border-[rgb(0_0_0/0.1)]",
    "fill-[#1a1714]",
    "[--ring:#00ff00]",
    "text-gray-500",
    "bg-red-50",
    "border-slate-200",
    "hover:text-white",
    "bg-black/40",
    "ring-emerald-500/30",
  ])("flags %s", (token) => {
    expect(rulesOf(token)).toEqual(["R2"])
  })

  it.each([
    "bg-surface",
    "text-ink",
    "border-line-strong",
    "bg-danger-tint",
    "text-white-space",
    "bg-transparent",
    "text-current",
    "bg-[var(--np-surface)]",
    "bg-red",
  ])("allows %s", (token) => {
    expect(rulesOf(token)).toEqual([])
  })

  it("finds colour literals in code, not fragments or ticket numbers", () => {
    expect(findColourLiterals("#FFFFFF").map((c) => c.match)).toEqual([
      "#FFFFFF",
    ])
    expect(findColourLiterals("1px solid #ddd").map((c) => c.match)).toEqual([
      "#ddd",
    ])
    expect(
      findColourLiterals("color: rgba(0, 0, 0, 0.4)").map((c) => c.match)
    ).toEqual(["rgba(0, 0, 0, 0.4)"])
    expect(findColourLiterals("#invite")).toEqual([])
    expect(findColourLiterals("Ticket #123 was closed")).toEqual([])
  })

  it("counts style colours and SVG fills but not comments, URLs or test ids", () => {
    const source = `
      // a comment with bg-white and #ffffff
      /* text-gray-500 */
      const a = <div style={{ color: "#333333" }} data-testid="bg-white" />
      const b = <svg><path fill="#ff0000" /></svg>
      const c = <a href="https://example.com/#abc" className="text-ink" />
    `
    const r2 = scan(source).filter((f) => f.rule === "R2")
    expect(r2.map((f) => f.pattern)).toEqual(["#333333", "#ff0000"])
  })

  it("does not count an arbitrary colour twice", () => {
    expect(analyseString("bg-[#fff] p-2")).toEqual([
      { rule: "R2", pattern: "bg-[#fff]", index: 0 },
    ])
  })
})

describe("R3 arbitrary spacing and size", () => {
  it.each([
    "h-[30px]",
    "min-h-[34px]",
    "max-w-[460px]",
    "max-w-[70ch]",
    "px-[11px]",
    "-mt-[3px]",
    "gap-[3px]",
    "top-[calc(var(--np-toolbar-h)+16px)]",
    "w-[min(300px,86vw)]",
    "flex-[1_1_12rem]",
    "grid-cols-[112px_minmax(0,1fr)]",
    "[padding:4px]",
  ])("flags %s", (token) => {
    expect(rulesOf(token)).toEqual(["R3"])
  })

  it.each([
    "h-9",
    "h-(--np-control-h)",
    "px-(--np-page-pad-x)",
    "min-h-[var(--np-touch)]",
    "h-[calc(var(--np-row-h)*2)]",
    "h-[100dvh]",
    "w-[100%]",
    "grid-cols-[minmax(0,1fr)_auto]",
    "max-h-[var(--available-height)]",
  ])("allows %s", (token) => {
    expect(rulesOf(token)).toEqual([])
  })
})

describe("R4 radius, shadow and z-index", () => {
  it.each([
    "rounded-[10px]",
    "rounded-t-[3px]",
    "rounded",
    "rounded-xs",
    "rounded-[calc(var(--np-radius-control)-2px)]",
    "shadow-[0_0_0_3px_var(--np-accent-tint)]",
    "shadow-sm",
    "shadow",
    "z-50",
    "focus:z-10",
    "-z-10",
    "z-[100]",
    "[box-shadow:0_0_0_2px_red]",
  ])("flags %s", (token) => {
    expect(rulesOf(token)).toEqual(["R4"])
  })

  it.each([
    "rounded-sm",
    "rounded-lg",
    "rounded-2xl",
    "rounded-full",
    "rounded-none",
    "rounded-[inherit]",
    "shadow-np-pop",
    "shadow-none",
    "shadow-[var(--np-focus-halo)]",
    "z-0",
    "z-auto",
  ])("allows %s", (token) => {
    expect(rulesOf(token)).toEqual([])
  })

  it("flags an inline numeric zIndex", () => {
    expect(rulesIn(`<div style={{ zIndex: 40 }} />`)).toContain("R4")
  })
})

describe("R5 raw primitives", () => {
  it("flags raw controls, Base UI imports and native dialogs in feature code", () => {
    const source = `
      import { Dialog } from "@base-ui/react/dialog"
      export function F() {
        if (window.confirm("Sure?")) alert("ok")
        return (
          <form>
            <select />
            <input type="checkbox" />
            <input type="radio" />
            <dialog />
            <table />
          </form>
        )
      }
    `
    expect(
      scan(source)
        .filter((f) => f.rule === "R5")
        .map((f) => f.pattern)
    ).toEqual([
      "@base-ui/react/dialog",
      "window.confirm()",
      "alert()",
      "<select>",
      `<input type="checkbox">`,
      `<input type="radio">`,
      "<dialog>",
      "<table>",
    ])
  })

  it("allows the same inside components/ui and ignores safe look-alikes", () => {
    const raw = `import { Select } from "@base-ui/react/select"\nconst x = <select />`
    expect(rulesIn(raw, "components/ui/select.tsx")).toEqual([])
    const safe = `
      import { Select } from "@/components/ui/select"
      const a = <input type="text" />
      const b = <Select />
      const c = dialog.confirm()
    `
    expect(rulesIn(safe)).toEqual([])
  })
})

describe("R6 inline styles", () => {
  it("counts one finding per styled object", () => {
    expect(rulesIn(`<div style={{ width: 4, height: 8 }} />`)).toEqual(["R6"])
  })

  it("allows custom-property-only styles", () => {
    expect(
      rulesIn(
        `<div style={{ "--np-enter-index": 2, ["--bar" as string]: 1 } as CSSProperties} />`
      )
    ).toEqual([])
    expect(rulesIn(`<div style={{ "--np-enter-index": i }} />`)).toEqual([])
  })

  it("sees through casts and spreads", () => {
    expect(rulesIn(`<div style={{ width: 4 } as CSSProperties} />`)).toEqual([
      "R6",
    ])
    expect(rulesIn(`<div style={{ ...base }} />`)).toEqual(["R6"])
  })
})

describe("R7 breakpoints", () => {
  it.each([
    "max-[1181px]:hidden",
    "min-[360px]:flex",
    "md:[@media(min-height:620px)]:h-full",
  ])("flags %s", (token) => {
    expect(rulesOf(token)).toEqual(["R7"])
  })

  it.each([
    "md:hidden",
    "@max-[720px]:grid-cols-1",
    "controls:flex",
    "max-md:hidden",
    "data-[state=open]:flex",
  ])("allows %s", (token) => {
    expect(rulesOf(token)).toEqual([])
  })

  it("flags a variant and its utility separately", () => {
    expect(rulesOf("max-[480px]:p-[3px]")).toEqual(["R7", "R3"])
  })

  it("flags literal media queries where they are written", () => {
    const source = `
      const DESKTOP = "(min-width: 768px)"
      const wide = useMediaQuery("(max-width: 1180.98px)")
      const shared = useMediaQuery(DESKTOP)
      const motion = matchMedia("(prefers-reduced-motion: reduce)")
    `
    expect(scan(source, "lib/x.ts").map((f) => [f.rule, f.pattern])).toEqual([
      ["R7", "(min-width: 768px)"],
      ["R7", "(max-width: 1180.98px)"],
    ])
  })
})

describe("source handling", () => {
  it("reads cn(), cva variants and template literals", () => {
    const source = `
      const v = cva("rounded-[7px]", { variants: { size: { sm: "h-[30px] text-[11px]" } } })
      const c = cn("px-3", ok && "bg-white", \`gap-2 \${x} z-50\`)
    `
    expect(scan(source, "lib/v.ts").map((f) => f.pattern)).toEqual([
      "rounded-[7px]",
      "h-[30px]",
      "text-[11px]",
      "bg-white",
      "z-50",
    ])
  })

  it("reports the line of each finding", () => {
    const findings = scan(
      `const a = 1\nconst b = cn(\n  "p-2",\n  "h-[30px]"\n)`,
      "lib/a.ts"
    )
    expect(findings).toMatchObject([{ rule: "R3", line: 4 }])
  })

  it("ignores type-level strings and import paths", () => {
    expect(
      rulesIn(
        `type T = "bg-white" | "z-50"\nimport x from "./z-50"`,
        "lib/t.ts"
      )
    ).toEqual([])
  })

  it("skips tests, stories and declarations", () => {
    expect(isIgnoredPath("components/a.test.tsx")).toBe(true)
    expect(isIgnoredPath("components/a.stories.tsx")).toBe(true)
    expect(isIgnoredPath("lib/types.d.ts")).toBe(true)
    expect(isIgnoredPath("components/a.tsx")).toBe(false)
  })
})

describe("ratchet", () => {
  const finding = (file: string, rule: string, pattern: string, line = 1) => ({
    file,
    rule,
    pattern,
    line,
    column: 1,
  })
  const baseline = {
    files: summarise([
      finding("a.tsx", "R3", "h-[30px]"),
      finding("a.tsx", "R3", "h-[30px]"),
      finding("b.tsx", "R1", "text-sm"),
    ]),
  }

  it("passes when nothing rose and reports what fell", () => {
    const { regressions, improvements } = compareToBaseline(
      [finding("a.tsx", "R3", "h-[30px]")],
      baseline
    )
    expect(regressions).toEqual([])
    expect(improvements).toEqual([
      { file: "a.tsx", rule: "R3", from: 2, to: 1 },
      { file: "b.tsx", rule: "R1", from: 1, to: 0 },
    ])
  })

  it("names the file, rule and lines whose pattern grew", () => {
    const { regressions } = compareToBaseline(
      [
        finding("a.tsx", "R3", "h-[30px]", 3),
        finding("a.tsx", "R3", "h-[30px]", 4),
        finding("a.tsx", "R3", "w-[51px]", 9),
        finding("b.tsx", "R1", "text-sm"),
      ],
      baseline
    )
    expect(regressions).toHaveLength(1)
    expect(regressions[0]).toMatchObject({
      file: "a.tsx",
      rule: "R3",
      from: 2,
      to: 3,
      newFile: false,
    })
    expect(regressions[0].findings.map((f: Finding) => f.line)).toEqual([9])
  })

  it("fails a new file that introduces findings", () => {
    const { regressions } = compareToBaseline(
      [
        ...[finding("a.tsx", "R3", "h-[30px]")],
        finding("c.tsx", "R6", "style={{…}}", 7),
      ],
      baseline
    )
    expect(regressions).toMatchObject([
      { file: "c.tsx", rule: "R6", from: 0, to: 1, newFile: true },
    ])
  })

  it("does not fail a swap within a rule", () => {
    const { regressions } = compareToBaseline(
      [
        finding("a.tsx", "R3", "h-[30px]"),
        finding("a.tsx", "R3", "w-[51px]"),
        finding("b.tsx", "R1", "text-sm"),
      ],
      baseline
    )
    expect(regressions).toEqual([])
  })
})

describe("reviewed exemptions", () => {
  it("exempts the listed rule on the next line only, with a reason", () => {
    const source = [
      "// design-exempt R2: meta theme-color is read before CSS loads",
      'const a = { color: "#f6f9fc" }',
      'const b = { color: "#0d1216" }',
    ].join("\n")
    const findings = scanSource(source, "app/example.tsx")
    expect(findings.filter((f) => f.rule === "R2").map((f) => f.line)).toEqual([
      3,
    ])
  })

  it("exempts every line of a start/end block", () => {
    const source = [
      "// design-exempt-start R2: the browser chrome colours",
      'const a = { color: "#f6f9fc" }',
      'const b = { color: "#0d1216" }',
      "// design-exempt-end",
      'const c = { color: "#ffffff" }',
    ].join("\n")
    const findings = scanSource(source, "app/example.tsx")
    expect(findings.filter((f) => f.rule === "R2").map((f) => f.line)).toEqual([
      5,
    ])
  })

  it("ignores a marker without a real reason or for another rule", () => {
    expect(exemptLines("// design-exempt R2: short\nx").size).toBe(0)
    const source = [
      "// design-exempt R6: inline style needed for a measured width",
      'const a = { color: "#f6f9fc" }',
    ].join("\n")
    expect(
      scanSource(source, "app/example.tsx").some((f) => f.rule === "R2")
    ).toBe(true)
  })
})
