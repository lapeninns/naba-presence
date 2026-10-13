#!/usr/bin/env node
/**
 * The design ratchet: counts the places application code steps around the
 * design tokens in app/globals.css, and holds that count to a committed
 * baseline so it can only go down.
 *
 *   node scripts/check-design.mjs                    # summary table, exits 0
 *   node scripts/check-design.mjs --json out.json    # every finding, with lines
 *   node scripts/check-design.mjs --update-baseline  # rewrite scripts/design-baseline.json
 *   node scripts/check-design.mjs --ratchet          # exits 1 if any file/rule count rose
 *
 * Sources are parsed with TypeScript's own parser and only string literals,
 * template text, JSX and calls are inspected, so comments never count. Class
 * strings are split into tokens and each token is read the way Tailwind reads
 * it: variants, then one utility. The rules and the matchers are exported for
 * tests/check-design.test.ts.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import ts from "typescript"

export const RULES = {
  R1: {
    title: "Arbitrary type size",
    description:
      "text-[<length>], leading-[…], leading-<n>, Tailwind's default text-xs…9xl scale, or an inline fontSize/lineHeight.",
    why: "Type sizes are seven roles with paired line heights; a one-off size drifts from the scale and from the fluid page title.",
    fix: "Use text-caption / ui / body / title / section / page-title / display / reading, or add a role to globals.css.",
  },
  R2: {
    title: "Literal colour",
    description:
      "A hex/rgb/hsl/oklch literal in TS/TSX, an arbitrary colour class (bg-[#…]), or a Tailwind palette colour (text-gray-500, bg-white).",
    why: "Literal and palette colours skip the contrast gate and do not switch with the dark theme.",
    fix: "Use a semantic role utility (text-ink-muted, bg-surface, border-line, bg-danger-tint…); add a role in layer 2 if none fits.",
  },
  R3: {
    title: "Arbitrary spacing or size",
    description:
      "p-/m-/gap-/w-/h-/size-/min-/max-/inset-/basis-/grid-cols-[…] with a px, rem, em or ch literal (var(--…) references are fine).",
    why: "One-off lengths are where density, touch targets and the page frame stop following the tokens.",
    fix: "Use the spacing scale or a --np-* token (h-(--np-control-h), px-(--np-page-pad-x)); add a token for a repeated value.",
  },
  R4: {
    title: "Arbitrary radius, shadow or z-index",
    description:
      "rounded-[…], bare rounded / rounded-xs, shadow-[…], shadow-sm…2xl, z-[…], raw z-10…z-50, or an inline zIndex.",
    why: "Radii and elevation are tokens (rounded-sm…4xl, shadow-np-*); stacking needs one scale so overlays cannot fight.",
    fix: "Use rounded-sm/md/lg/xl/2xl/full and shadow-np-raised/pop/modal/hairline; z-index waits for the shared scale.",
  },
  R5: {
    title: "Raw primitive in feature code",
    description:
      "An @base-ui/react import, a raw <select>, <dialog>, <table>, <input type=checkbox|radio>, or window.confirm/alert/prompt outside components/ui.",
    why: "The primitives in components/ui carry focus, touch size, labelling and theming; raw elements re-solve all of that.",
    fix: "Use the components/ui primitive (Select, Dialog/AlertDialog, Table/DataTable, Checkbox, RadioGroup).",
  },
  R6: {
    title: "Inline style",
    description:
      "A style={{…}} object that sets anything other than CSS custom properties.",
    why: "Inline styles bypass the token utilities, variants and dark theme.",
    fix: "Use utilities; for a runtime value set a custom property (style={{ '--x': v }}) and read it with a utility.",
  },
  R7: {
    title: "Literal breakpoint",
    description:
      "A media-query string with a literal width (for useMediaQuery/matchMedia), or an arbitrary max-[…]: / min-[…]: / [@media…]: variant.",
    why: "Layouts that pick their own pixel breakpoints drift apart from the shell's 768 / 1180 split.",
    fix: "Use sm/md/lg/xl, the controls/capsules variants, or a container query (@max-*); share JS queries from one module.",
  },
}

export const RULE_IDS = Object.keys(RULES)

const root = fileURLToPath(new URL("../", import.meta.url))
export const BASELINE_PATH = "scripts/design-baseline.json"
const SCAN_DIRS = ["app", "components", "lib"]
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "__tests__",
  "__snapshots__",
  "__mocks__",
])

/** Test, story and declaration files, and anything marked generated. */
export function isIgnoredPath(path) {
  return (
    !/\.(tsx?|mts)$/.test(path) ||
    /\.d\.m?ts$/.test(path) ||
    /\.(test|spec|stories)\.(tsx?|mts)$/.test(path)
  )
}

const isPrimitivePath = (path) => path.startsWith("components/ui/")

// ---------------------------------------------------------------------------
// Value helpers

const COLOUR_FN = /\b(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb|color)\(/i
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/i

/** Removes var(--…) references, including one level of fallback nesting. */
const stripVars = (value) =>
  value
    .replace(/var\(--[^()]*(?:\([^()]*\)[^()]*)*\)/g, "")
    .replace(/^\(--[\w-]+\)$/, "")

export const hasColourLiteral = (value) =>
  COLOUR_FN.test(value) || HEX.test(value)

/** A length a designer chose: px, rem, em, ch or pt. Viewport and % units are layout-relative. */
export const hasLengthLiteral = (value) =>
  /(?:^|[^a-z0-9.-])-?\d*\.?\d+(?:px|rem|em|ch|pt)(?![a-z])/i.test(
    stripVars(value)
  )

/**
 * True when an arbitrary value carries a number or colour of its own, rather
 * than custom-property references and keywords (`inherit`, `inset_var(--x)`).
 */
export const hasLiteral = (value) =>
  hasColourLiteral(value) || /\d/.test(stripVars(value))

// ---------------------------------------------------------------------------
// Class tokens

/** Splits `md:hover:max-[720px]:p-[3px]` on the colons Tailwind splits on. */
export function splitVariants(token) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < token.length; i++) {
    const ch = token[i]
    if (ch === "[" || ch === "(") depth++
    else if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1)
    else if (ch === ":" && depth === 0) {
      parts.push(token.slice(start, i))
      start = i + 1
    }
  }
  parts.push(token.slice(start))
  return parts
}

const PALETTE =
  "slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose"
const COLOUR_UTILITY =
  "bg|text|border(?:-[xytrblse])?|divide|outline|ring|ring-offset|inset-ring|fill|stroke|from|via|to|decoration|placeholder|caret|accent|shadow|inset-shadow|drop-shadow"
const PALETTE_CLASS = new RegExp(
  `^(?:${COLOUR_UTILITY})-(?:(?:${PALETTE})-(?:50|[1-9]00|950)|white|black)(?:\\/[\\w.\\[\\]%-]+)?$`
)
const DEFAULT_TEXT_SIZE = /^text-(?:xs|sm|base|lg|[2-9]?xl)(?:\/[\w.\[\]-]+)?$/
const SPACING_PREFIX =
  /^(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|w|h|size|min-w|min-h|max-w|max-h|inset(?:-[xy])?|top|right|bottom|left|start|end|basis|flex|indent|translate-[xyz]|scroll-[mp][xytrblse]?|grid-cols|grid-rows|auto-cols|auto-rows|columns)$/
const ROUNDED_PREFIX = /^rounded(?:-(?:[trblse]|tl|tr|br|bl|ss|se|es|ee))?$/
const ARBITRARY = /^([a-z][a-z0-9-]*?)-\[(.+)\]$/
const ARBITRARY_PROPERTY = /^\[([a-z-]+):(.+)\]$/

/**
 * Reads one whitespace-delimited class token. Returns the findings it holds
 * as { rule, pattern }; `pattern` is the utility or variant without state
 * variants, so `hover:bg-white` and `bg-white` count as the same thing.
 */
export function analyseClassToken(raw) {
  const token = raw.replace(/^[,'"`{(]+|[,'"`;})]+$/g, "")
  if (!token || token.length > 200 || !/^[!@\[a-z-]/.test(token)) return []
  const findings = []
  const parts = splitVariants(token)
  const utility = parts
    .pop()
    .replace(/^!|!$/g, "")
    .replace(/^-(?=[a-z])/, "")

  for (const variant of parts) {
    if (
      /^(?:max|min)-\[.+\]$/.test(variant) ||
      (/^\[@media.+\]$/.test(variant) && hasLengthLiteral(variant))
    )
      findings.push({ rule: "R7", pattern: `${variant}:` })
  }

  const finding = analyseUtility(utility)
  if (finding) findings.push({ rule: finding, pattern: utility })
  return findings
}

function analyseUtility(utility) {
  if (PALETTE_CLASS.test(utility)) return "R2"
  if (DEFAULT_TEXT_SIZE.test(utility)) return "R1"
  if (/^leading-\d+(?:\.\d+)?$/.test(utility)) return "R1"
  if (
    /^(?:rounded(?:-(?:[trblse]|tl|tr|br|bl|ss|se|es|ee))?(?:-xs)?)$/.test(
      utility
    )
  )
    return "R4"
  if (/^shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl))?(?:\/\d+)?$/.test(utility))
    return "R4"
  if (/^z-\d+$/.test(utility) && utility !== "z-0") return "R4"

  const property = ARBITRARY_PROPERTY.exec(utility)
  if (property) return analyseArbitraryProperty(property[1], property[2])

  const arbitrary = ARBITRARY.exec(utility)
  if (!arbitrary) return null
  const [, prefix, value] = arbitrary
  if (SPACING_PREFIX.test(prefix)) return hasLengthLiteral(value) ? "R3" : null
  if (
    ROUNDED_PREFIX.test(prefix) ||
    prefix === "z" ||
    prefix === "shadow" ||
    prefix === "drop-shadow"
  )
    return hasLiteral(value) ? "R4" : null
  if (prefix === "leading") return hasLiteral(value) ? "R1" : null
  if (hasColourLiteral(value)) return "R2"
  if (prefix === "text") {
    if (
      value.startsWith("length:")
        ? hasLiteral(value.slice(7))
        : hasLengthLiteral(value) || /^(?:clamp|calc|min|max)\(/.test(value)
    )
      return "R1"
  }
  return null
}

function analyseArbitraryProperty(property, value) {
  if (hasColourLiteral(value)) return "R2"
  if (/^(?:font-size|line-height)$/.test(property))
    return hasLiteral(value) ? "R1" : null
  if (/^(?:border-radius|box-shadow|z-index)$/.test(property))
    return hasLiteral(value) ? "R4" : null
  if (
    /^(?:padding|margin|gap|width|height|min-|max-|inset|top|right|bottom|left)/.test(
      property
    )
  )
    return hasLengthLiteral(value) ? "R3" : null
  return null
}

/**
 * Colour literals in free text: functions anywhere, hex only where it reads as
 * CSS (the whole string, or after `:`, `(`, `,`, `[`, `=` or a border style),
 * so "#invite" fragments and "ticket #123" do not count.
 */
export function findColourLiterals(text) {
  const found = []
  const trimmed = text.trim()
  if (/^#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})$/i.test(trimmed)) {
    return [{ index: text.indexOf(trimmed), match: trimmed }]
  }
  for (const m of text.matchAll(
    /\b(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb|color)\([^()]*(?:\([^()]*\)[^()]*)*\)/gi
  ))
    found.push({ index: m.index, match: m[0] })
  for (const m of text.matchAll(
    /(?:[:(,[=]\s*|(?:solid|dashed|dotted|double)\s+)(#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4}))(?![0-9a-z_-])/gi
  ))
    found.push({ index: m.index + m[0].length - m[1].length, match: m[1] })
  return found
}

const MEDIA_QUERY =
  /^\s*(?:@media\s*)?(?:(?:only\s+)?(?:screen|all)\s+and\s+)?\(\s*(?:min|max)-(?:width|height)\s*:/

/** All findings in one string: class tokens first, then colours outside them. */
export function analyseString(text) {
  const findings = []
  const covered = []
  // A media query written out in TS, for useMediaQuery / matchMedia or a
  // constant that feeds them. Counted where the literal is, not where it is
  // used, so one shared constant counts once.
  if (MEDIA_QUERY.test(text) && hasLengthLiteral(text)) {
    return [
      {
        rule: "R7",
        pattern: text.trim().replace(/\s+/g, " "),
        index: text.search(/\S/),
      },
    ]
  }
  for (const m of text
    .replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, (url) => " ".repeat(url.length))
    .matchAll(/\S+/g)) {
    const tokenFindings = analyseClassToken(m[0])
    if (tokenFindings.length || /^[!@a-z-][\w!:@.\/-]*\[.*\]/.test(m[0]))
      covered.push([m.index, m.index + m[0].length])
    for (const f of tokenFindings) findings.push({ ...f, index: m.index })
  }
  for (const c of findColourLiterals(text)) {
    if (covered.some(([s, e]) => c.index >= s && c.index < e)) continue
    findings.push({
      rule: "R2",
      pattern: c.match.replace(/\s+/g, " "),
      index: c.index,
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// Sources

/** JSX attributes whose strings are copy, ids, URLs or ARIA, never styling. */
const SKIP_ATTRIBUTES =
  /^(?:data-.*|aria-.*|id|key|href|src|srcSet|alt|title|placeholder|name|htmlFor|role|type|value|defaultValue|label|description|content|rel|target|download|action|method|autoComplete|inputMode|pattern|lang|dir|tabIndex|accept|form|sizes)$/
const SKIP_KEYS =
  /^(?:href|src|url|path|pathname|id|key|testId|testid|data-testid|label|title|description|message|placeholder|aria-label)$/i

/** Scans one source file. `path` is repo-relative with forward slashes. */
export function scanSource(text, path) {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind
  )
  const primitive = isPrimitivePath(path)
  const findings = []
  const add = (rule, pattern, pos) => {
    const { line, character } = source.getLineAndCharacterOfPosition(pos)
    findings.push({
      file: path,
      rule,
      line: line + 1,
      column: character + 1,
      pattern,
    })
  }

  const visitString = (node) => {
    const start = node.getStart(source) + 1
    for (const f of analyseString(node.text))
      add(f.rule, f.pattern, start + f.index)
  }

  const visit = (node) => {
    if (ts.isLiteralTypeNode(node) || ts.isTypeReferenceNode(node)) return

    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      visitString(node)
      return
    }

    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier
      if (
        !primitive &&
        spec &&
        ts.isStringLiteral(spec) &&
        spec.text.startsWith("@base-ui/react")
      )
        add("R5", spec.text, spec.getStart(source))
      return
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source)
      const first = node.arguments[0]
      const firstText =
        first &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
          ? first.text
          : null
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        callee === "require"
      ) {
        if (!primitive && firstText?.startsWith("@base-ui/react"))
          add("R5", firstText, first.getStart(source))
        return
      }
      if (
        !primitive &&
        /^(?:(?:window|globalThis|self)\.)?(?:confirm|alert|prompt)$/.test(
          callee
        )
      )
        add(
          "R5",
          `${callee.replace(/^(?:globalThis|self)\./, "window.")}()`,
          node.getStart(source)
        )
    }

    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) {
      const key = node.name.getText(source).replace(/^["']|["']$/g, "")
      if (SKIP_KEYS.test(key)) return
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source)
      if (!primitive && /^(?:select|dialog|table)$/.test(tag))
        add("R5", `<${tag}>`, node.getStart(source))
      if (!primitive && tag === "input") {
        for (const attr of node.attributes.properties) {
          if (
            ts.isJsxAttribute(attr) &&
            attr.name.getText(source) === "type" &&
            attr.initializer &&
            ts.isStringLiteral(attr.initializer) &&
            /^(?:checkbox|radio)$/.test(attr.initializer.text)
          )
            add(
              "R5",
              `<input type="${attr.initializer.text}">`,
              node.getStart(source)
            )
        }
      }
    }

    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source)
      if (SKIP_ATTRIBUTES.test(name)) return
      if (name === "style") visitStyle(node)
    }

    ts.forEachChild(node, visit)
  }

  const visitStyle = (attr) => {
    const init = attr.initializer
    if (!init || !ts.isJsxExpression(init) || !init.expression) return
    // `style={{ … } as CSSProperties}` is still an inline style.
    const object = ts.skipOuterExpressions(init.expression)
    if (!ts.isObjectLiteralExpression(object)) return
    let styled = false
    for (const prop of object.properties) {
      const name =
        prop.name && ts.isComputedPropertyName(prop.name)
          ? ts.skipOuterExpressions(prop.name.expression)
          : prop.name
      const key = name ? name.getText(source).replace(/^["'`]|["'`]$/g, "") : ""
      if (key.startsWith("--")) continue
      styled = true
      if (/^(?:fontSize|lineHeight)$/.test(key))
        add("R1", `style.${key}`, prop.getStart(source))
      if (
        key === "zIndex" &&
        ts.isPropertyAssignment(prop) &&
        ts.isNumericLiteral(prop.initializer)
      )
        add("R4", `style.zIndex`, prop.getStart(source))
    }
    if (styled) add("R6", "style={{…}}", attr.getStart(source))
  }

  visit(source)
  return findings
}

// ---------------------------------------------------------------------------
// Collection, baseline and ratchet

export function listSourceFiles(base = root) {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith("."))
          walk(`${dir}/${entry.name}`)
      } else {
        const path = relative(base, `${dir}/${entry.name}`).split(sep).join("/")
        if (!isIgnoredPath(path)) files.push(path)
      }
    }
  }
  for (const dir of SCAN_DIRS) walk(`${base}/${dir}`)
  return files.sort()
}

export function scanRepository(base = root) {
  const findings = []
  for (const path of listSourceFiles(base)) {
    const text = readFileSync(`${base}/${path}`, "utf8")
    if (/@generated|DO NOT EDIT/.test(text.slice(0, 400))) continue
    findings.push(...scanSource(text, path))
  }
  return findings
}

/** { file: { rule: { total, patterns: { pattern: count } } } }, keys sorted. */
export function summarise(findings) {
  const files = {}
  for (const f of findings) {
    const rule = ((files[f.file] ??= {})[f.rule] ??= { total: 0, patterns: {} })
    rule.total++
    rule.patterns[f.pattern] = (rule.patterns[f.pattern] ?? 0) + 1
  }
  const sorted = {}
  for (const file of Object.keys(files).sort()) {
    sorted[file] = {}
    for (const rule of RULE_IDS.filter((id) => files[file][id])) {
      const { total, patterns } = files[file][rule]
      sorted[file][rule] = {
        total,
        patterns: Object.fromEntries(
          Object.entries(patterns).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          )
        ),
      }
    }
  }
  return sorted
}

export function ruleTotals(files) {
  const totals = Object.fromEntries(RULE_IDS.map((id) => [id, 0]))
  for (const rules of Object.values(files))
    for (const [id, r] of Object.entries(rules)) totals[id] += r.total
  return totals
}

/**
 * Compares a scan with the baseline. A file/rule regresses when its total
 * rises (a new file starts from zero); the patterns whose counts rose name
 * the lines to look at.
 */
export function compareToBaseline(findings, baseline) {
  const current = summarise(findings)
  const regressions = []
  const improvements = []
  for (const file of new Set([
    ...Object.keys(current),
    ...Object.keys(baseline.files),
  ])) {
    for (const rule of RULE_IDS) {
      const now = current[file]?.[rule]
      const was = baseline.files[file]?.[rule]
      const delta = (now?.total ?? 0) - (was?.total ?? 0)
      if (delta < 0)
        improvements.push({ file, rule, from: was.total, to: now?.total ?? 0 })
      if (delta <= 0) continue
      const grown = new Set(
        Object.entries(now.patterns)
          .filter(([pattern, count]) => count > (was?.patterns[pattern] ?? 0))
          .map(([pattern]) => pattern)
      )
      regressions.push({
        file,
        rule,
        from: was?.total ?? 0,
        to: now.total,
        newFile: !baseline.files[file],
        findings: findings.filter(
          (f) => f.file === file && f.rule === rule && grown.has(f.pattern)
        ),
      })
    }
  }
  return { regressions, improvements }
}

function topDirectory(file) {
  const parts = file.split("/")
  const depth = parts[1]?.startsWith("(") ? 3 : 2
  return parts.length > depth
    ? parts.slice(0, depth).join("/")
    : parts.slice(0, -1).join("/") || parts[0]
}

function printSummary(findings) {
  const files = summarise(findings)
  const totals = ruleTotals(files)
  const dirs = new Map()
  for (const [file, rules] of Object.entries(files)) {
    const row =
      dirs.get(topDirectory(file)) ??
      Object.fromEntries(RULE_IDS.map((id) => [id, 0]))
    for (const [id, r] of Object.entries(rules)) row[id] += r.total
    dirs.set(topDirectory(file), row)
  }
  const sum = (row) => RULE_IDS.reduce((n, id) => n + row[id], 0)
  const rows = [...dirs].sort((a, b) => sum(b[1]) - sum(a[1]))
  const shown = rows.slice(0, 20)
  const rest = rows.slice(20)
  if (rest.length) {
    const other = Object.fromEntries(
      RULE_IDS.map((id) => [id, rest.reduce((n, [, r]) => n + r[id], 0)])
    )
    shown.push([`(${rest.length} more directories)`, other])
  }
  const width = Math.max(...shown.map(([d]) => d.length), 9)
  const cell = (v) => String(v || "·").padStart(6)
  const out = []
  out.push(
    `${"".padEnd(width)} ${RULE_IDS.map((id) => id.padStart(6)).join("")}  total`
  )
  for (const [dir, row] of shown)
    out.push(
      `${dir.padEnd(width)} ${RULE_IDS.map((id) => cell(row[id])).join("")} ${String(sum(row)).padStart(6)}`
    )
  out.push(
    `${"total".padEnd(width)} ${RULE_IDS.map((id) => cell(totals[id])).join("")} ${String(sum(totals)).padStart(6)}`
  )
  out.push("")
  for (const id of RULE_IDS) {
    const patterns = new Map()
    for (const f of findings)
      if (f.rule === id)
        patterns.set(f.pattern, (patterns.get(f.pattern) ?? 0) + 1)
    const top = [...patterns]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([p, n]) => `${p} ×${n}`)
    out.push(
      `${id} ${RULES[id].title} (${totals[id]}): ${top.join(", ") || "none"}`
    )
    out.push(`   fix: ${RULES[id].fix}`)
  }
  out.push(
    "",
    `${Object.keys(files).length} files with findings. Details: --json <file>. Gate: --ratchet.`
  )
  process.stdout.write(out.join("\n") + "\n")
}

function writeBaseline(findings) {
  const files = summarise(findings)
  const baseline = {
    $comment:
      "Design ratchet baseline. Regenerate with `pnpm check:design --update-baseline` after removing findings; never to accept new ones. See scripts/check-design.mjs.",
    totals: ruleTotals(files),
    files,
  }
  writeFileSync(
    `${root}/${BASELINE_PATH}`,
    JSON.stringify(baseline, null, 2) + "\n"
  )
  const total = Object.values(baseline.totals).reduce((a, b) => a + b, 0)
  process.stdout.write(
    `Wrote ${BASELINE_PATH}: ${total} findings in ${Object.keys(files).length} files (${RULE_IDS.map((id) => `${id} ${baseline.totals[id]}`).join(", ")}).\n`
  )
}

function ratchet(findings) {
  let baseline
  try {
    baseline = JSON.parse(readFileSync(`${root}/${BASELINE_PATH}`, "utf8"))
  } catch {
    process.stderr.write(
      `No baseline at ${BASELINE_PATH}. Run: pnpm check:design --update-baseline\n`
    )
    return 2
  }
  const { regressions, improvements } = compareToBaseline(findings, baseline)
  const out = []
  for (const r of regressions) {
    out.push(
      `✗ ${r.file}  ${r.rule} ${RULES[r.rule].title}: ${r.from} → ${r.to} (+${r.to - r.from})${r.newFile ? "  [new file]" : ""}`
    )
    for (const f of r.findings)
      out.push(`    ${f.file}:${f.line}:${f.column}  ${f.pattern}`)
    out.push(`    fix: ${RULES[r.rule].fix}`)
  }
  const removed = improvements.reduce((n, i) => n + i.from - i.to, 0)
  if (improvements.length) {
    out.push(
      `${regressions.length ? "\n" : ""}✓ ${removed} finding(s) removed across ${new Set(improvements.map((i) => i.file)).size} file(s) — nice work.`,
      "  Lock it in: pnpm check:design --update-baseline (and commit scripts/design-baseline.json)."
    )
  }
  if (regressions.length) {
    out.push(
      `\nDesign ratchet failed: ${regressions.length} file/rule count(s) rose above ${BASELINE_PATH}.`,
      "Use the tokens instead. The baseline only moves down; do not regenerate it to accept new findings."
    )
  } else {
    out.push(
      `Design ratchet passed: no file/rule count rose above ${BASELINE_PATH}.`
    )
  }
  ;(regressions.length ? process.stderr : process.stdout).write(
    out.join("\n") + "\n"
  )
  return regressions.length ? 1 : 0
}

function main(argv) {
  const findings = scanRepository()
  const jsonAt = argv.indexOf("--json")
  if (jsonAt !== -1) {
    const target = argv[jsonAt + 1]
    if (!target || target.startsWith("--")) {
      process.stderr.write("--json needs a file path\n")
      return 2
    }
    const files = summarise(findings)
    writeFileSync(
      target,
      JSON.stringify(
        { rules: RULES, totals: ruleTotals(files), files, findings },
        null,
        2
      ) + "\n"
    )
    process.stdout.write(`Wrote ${findings.length} findings to ${target}\n`)
  }
  if (argv.includes("--update-baseline")) {
    writeBaseline(findings)
    return 0
  }
  if (argv.includes("--ratchet")) return ratchet(findings)
  if (jsonAt === -1) printSummary(findings)
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2))
}
