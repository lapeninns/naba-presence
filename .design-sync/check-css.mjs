#!/usr/bin/env node
/* Assert the compiled DS stylesheet is actually usable before anything ships.

   Why this exists: Tailwind treats a malformed comment in the entry file as a
   WARNING and still exits 0. A stray close-comment marker once left the `@theme`
   block parsed as part of a selector, so the font tokens never registered — and
   (note the irony) an early draft of THIS file tripped the same thing by writing
   that marker literally inside its own block comment. `--font-sans` fell
   back to the `var(--font-sans)` self-reference from app/globals.css, which
   resolves to nothing outside the Next app. Every preview card, and every design
   the agent would build, silently rendered in browser-default serif. The build
   was green throughout, and `[FONT_MISSING]` did NOT fire — with the block dead
   nothing referenced the families, so nothing was reported missing.

   Two independent checks, because either alone has a blind spot:
     - a literal family name is present (proves @theme registered)
     - --font-sans is not self-referential (proves globals.css didn't win)

   Chained after the tailwind step in cfg.buildCmd. */

import { readFileSync, existsSync } from "node:fs"

const CSS = process.argv[2] ?? ".design-sync/.cache/ds-compiled.css"

if (!existsSync(CSS)) {
  console.error(`[CSS] ${CSS} does not exist — the tailwind step did not produce output.`)
  process.exit(1)
}

const css = readFileSync(CSS, "utf8")
const problems = []

if (!/--font-sans:\s*"?Geist/.test(css)) {
  problems.push(
    `--font-sans does not resolve to a literal Geist family.\n` +
      `        The @theme block in .design-sync/ds-tailwind.css did not register.\n` +
      `        Most likely a malformed comment there — Tailwind only warns and exits 0.`
  )
}

const selfRef = [...css.matchAll(/--font-(sans|mono):\s*var\(--font-\1\)/g)].map((m) => m[1])
if (selfRef.length) {
  problems.push(
    `--font-${selfRef.join(", --font-")} is self-referential (\`var(--font-*)\`).\n` +
      `        That is app/globals.css's runtime wiring leaking into the bundle; it resolves\n` +
      `        to nothing without next/font, so text renders in the browser default serif.`
  )
}

// The stylesheet is also the tokens carrier — a compile that lost the palette is
// as broken as one that lost the fonts.
if (!/--primary:/.test(css)) {
  problems.push("--primary is not defined — the palette tokens are missing from the compiled CSS.")
}

if (problems.length) {
  console.error(`[CSS] ${CSS} is not shippable:`)
  for (const p of problems) console.error(`      - ${p}`)
  process.exit(1)
}

const kb = Math.round(css.length / 1024)
console.log(`[CSS] ${CSS} OK — literal font families, no self-reference, palette present (${kb} KB)`)
