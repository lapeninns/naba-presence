// Render every concept to static HTML and to PNG (then WebP).
//
//   node docs/redesign/2026-11/concepts/src/render.mjs <out-dir> [--only <regex>]
//
// HTML: <out-dir>/html/<name>.html, real HTML/CSS (inline styles, flexbox),
//       openable in any browser; `shoot.mjs` re-screenshots them with
//       Playwright where a browser can run.
// PNG:  <out-dir>/png/<name>.png via satori + resvg (the copies bundled in
//       next/dist/compiled/@vercel/og), which need no browser. Used because
//       the phase-B sandbox could not launch any browser engine.
// Fonts: static instances of the system sans (SF Pro) at 400/500/600/700,
//       read from FONT_DIR (not committed; see README.md for how they are made).

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { ImageResponse } from "next/dist/compiled/@vercel/og/index.node.js"

import { CONCEPTS } from "./concepts.mjs"

const out = resolve(process.argv[2] ?? "concept-out")
const onlyIdx = process.argv.indexOf("--only")
const only = onlyIdx > -1 ? new RegExp(process.argv[onlyIdx + 1]) : null
const FONT_DIR =
  process.env.FONT_DIR ?? resolve("test-results/b-direction/fonts")

const fonts = []
for (const weight of [400, 500, 600, 700]) {
  fonts.push({
    name: "NP Sans",
    data: await readFile(`${FONT_DIR}/SF-${weight}.ttf`),
    weight,
    style: "normal",
  })
}
fonts.push({
  name: "NP Mono",
  data: await readFile(`${FONT_DIR}/SFMono-400.ttf`),
  weight: 400,
  style: "normal",
})

// ---- HTML serialiser ----------------------------------------------------------
const UNITLESS = new Set([
  "fontWeight",
  "lineHeight",
  "flexGrow",
  "flexShrink",
  "opacity",
  "zIndex",
  "flex",
])
const kebab = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
function css(style = {}) {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(
      ([k, v]) =>
        `${kebab(k)}:${typeof v === "number" && !UNITLESS.has(k) ? `${v}px` : v}`
    )
    .join(";")
}
const SVG_ATTR = {
  strokeWidth: "stroke-width",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  viewBox: "viewBox",
  strokeDasharray: "stroke-dasharray",
}
function html(node) {
  if (node === null || node === undefined || node === false) return ""
  if (typeof node === "string" || typeof node === "number") return esc(node)
  if (Array.isArray(node)) return node.map(html).join("")
  const { type, props = {} } = node
  const { children, style, ...attrs } = props
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${SVG_ATTR[k] ?? k}="${esc(v)}"`)
    .join("")
  const styleStr = style ? ` style="${esc(css(style))}"` : ""
  return `<${type}${attrStr}${styleStr}>${html(children)}</${type}>`
}

function page(name, concept, tree) {
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=${concept.width}">
<title>${esc(concept.title)} (${name})</title>
<style>
  /* Concept mockup, not application code. System sans as in app/globals.css. */
  html,body{margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased}
  div{box-sizing:border-box}
</style></head>
<body><div style="${esc(css({ width: concept.width, height: concept.height, display: "flex", overflow: "hidden", position: "relative" }))}">${html(tree)}</div></body></html>
`
}

await mkdir(resolve(out, "html"), { recursive: true })
await mkdir(resolve(out, "png"), { recursive: true })
let n = 0
for (const [name, concept] of Object.entries(CONCEPTS)) {
  if (only && !only.test(name)) continue
  const tree = concept.build()
  await writeFile(
    resolve(out, "html", `${name}.html`),
    page(name, concept, tree)
  )
  const root = {
    type: "div",
    props: {
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
        fontFamily: "NP Sans",
        position: "relative",
        overflow: "hidden",
      },
      children: tree,
    },
  }
  const res = new ImageResponse(root, {
    width: concept.width,
    height: concept.height,
    fonts,
  })
  await writeFile(
    resolve(out, "png", `${name}.png`),
    Buffer.from(await res.arrayBuffer())
  )
  n++
  console.log(`rendered ${name} ${concept.width}x${concept.height}`)
}
console.log(`${n} concept(s) -> ${out}`)
