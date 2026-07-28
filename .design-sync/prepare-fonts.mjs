#!/usr/bin/env node
/* Harvest the Geist / Geist Mono webfonts out of Next's build output into a
   self-contained @font-face stylesheet the design-sync bundle can ship.

   Why this exists: the app loads its fonts through next/font/google, which
   downloads the woff2 subsets at build time and emits the @font-face rules into
   a CSS chunk. Neither is committed, so without this step the DS bundle
   references font families while shipping no font files — validate reports
   [FONT_MISSING] and every design the agent builds renders in a fallback face.

   Two things here are deliberate, both learned the hard way:

   1. FAMILY NAMES ARE NORMALIZED. next/font's emitted family name is not
      stable: the production chunk names families after the JS variable that
      declared them ("geist", "fontMono"), while the dev chunk uses the real
      names ("Geist", "Geist Mono") — and which one you get varies by build.
      Rather than depend on that, every harvested face is re-labelled to a
      canonical family, matching what .design-sync/ds-tailwind.css declares.

   2. FILES ARE RENAMED. Next's names are opaque content hashes containing "~"
      and several dots (e.g. "6306c77e7c8268e4-s.0rhz0arwfsn~5.woff2"), which
      upload path validation rejects.

   Only faces with a real url() are shipped. next/font also emits "<Family>
   Fallback" faces built from local() metric-adjusted system fonts; those have
   no file to ship, and naming them would leave the bundle referencing families
   it cannot provide.

   Output (committed, referenced by cfg.extraFonts):
     .design-sync/fonts/geist.css     @font-face rules, canonical families
     .design-sync/fonts/*.woff2       the subset files themselves

   Re-run after any `pnpm build`. Idempotent for a given build output. */

import { mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync, statSync } from "node:fs"
import { join, basename } from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath, not .pathname — this repo's path contains a space, which
// .pathname would hand back percent-encoded ("LapenInns%20Project").
const REPO = fileURLToPath(new URL("..", import.meta.url))
const NEXT = join(REPO, ".next")
const OUT = join(REPO, ".design-sync/fonts")

if (!existsSync(NEXT)) {
  console.error("[FONTS] .next not found — run the app build first (`pnpm build`), then re-run this script.")
  process.exit(1)
}

// Walk .next for CSS and media, covering both the production (.next/static) and
// dev (.next/dev/static) trees — the two disagree on family naming and on how
// many subsets they emit, so we take the union and let dedupe sort it out.
function walk(dir, test, acc = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return acc }
  for (const e of entries) {
    const p = join(dir, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, test, acc)
    else if (test(p)) acc.push(p)
  }
  return acc
}

const cssFiles = walk(NEXT, (p) => p.endsWith(".css"))
const mediaFiles = new Map() // basename -> absolute path
for (const p of walk(NEXT, (p) => p.endsWith(".woff2"))) {
  if (!mediaFiles.has(basename(p))) mediaFiles.set(basename(p), p)
}

// Canonical family for a face, derived from the declared name however it was
// spelled. This repo ships exactly the two Geist families.
function canonical(family) {
  return /mono/i.test(family) ? "Geist Mono" : "Geist"
}

const faces = [] // {family, file, block}
const seen = new Set() // `${family}|${file}` — the same subset appears in both trees
for (const f of cssFiles) {
  const css = readFileSync(f, "utf8")
  if (!css.includes("@font-face")) continue
  for (const m of css.matchAll(/@font-face\s*\{[^}]*\}/g)) {
    const block = m[0]
    const declared = block.match(/font-family:\s*([^;}]+)/)?.[1]?.trim().replace(/["']/g, "")
    if (!declared) continue
    const url = block.match(/url\(([^)]+)\)/)
    if (!url) continue // local()-only fallback face: nothing to ship
    const file = basename(url[1].trim().replace(/["']/g, ""))
    if (!mediaFiles.has(file)) continue
    const family = canonical(declared)
    const key = `${family}|${file}`
    if (seen.has(key)) continue
    seen.add(key)
    faces.push({ family, file, block })
  }
}

const families = new Set(faces.map((f) => f.family))
const REQUIRED = ["Geist", "Geist Mono"]
const absent = REQUIRED.filter((f) => !families.has(f))
if (absent.length) {
  console.error(
    `[FONTS] no shippable faces found for: ${absent.join(", ")}\n` +
      `        Scanned ${cssFiles.length} CSS file(s) and ${mediaFiles.size} woff2 under .next.\n` +
      `        Run \`pnpm build\` and re-run; ds-tailwind.css declares these families, so the bundle needs them.`
  )
  process.exit(1)
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const perFamily = new Map()
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")

// Stable ordering so repeated runs over the same build produce identical output.
faces.sort((a, b) => a.family.localeCompare(b.family) || a.file.localeCompare(b.file))

const rules = faces.map(({ family, file, block }) => {
  const base = slug(family)
  const n = (perFamily.get(base) ?? 0) + 1
  perFamily.set(base, n)
  const name = `${base}-${n}.woff2`
  copyFileSync(mediaFiles.get(file), join(OUT, name))
  return block
    .replace(/font-family:\s*[^;}]+/, `font-family: "${family}"`)
    .replace(/url\([^)]+\)/, `url(./${name})`)
})

const header = `/* Generated by .design-sync/prepare-fonts.mjs from Next's build output.
   Do not hand-edit — re-run the script instead.
   Families normalized to: ${[...families].sort().join(", ")} */\n`

writeFileSync(join(OUT, "geist.css"), header + rules.join("\n") + "\n")

const counts = [...perFamily.entries()].map(([f, n]) => `${f}=${n}`).join(", ")
console.log(`[FONTS] ${rules.length} face(s) shipped (${counts}); families: ${[...families].sort().join(", ")}`)
