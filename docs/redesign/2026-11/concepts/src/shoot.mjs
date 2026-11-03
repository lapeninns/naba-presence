// Re-shoot the concept HTML with Playwright where a browser can run.
//   node docs/redesign/2026-11/concepts/src/shoot.mjs <html-dir> <out-dir>
// Each page's viewport comes from its <meta name="viewport" content="width=N">
// and the root element's height. Chromium, light theme, reduced motion, dpr 2.
import { mkdir, readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium } from "@playwright/test"

const [htmlDir = "docs/redesign/2026-11/concepts/html", out = "concept-shots"] =
  process.argv.slice(2)
await mkdir(resolve(out), { recursive: true })
const browser = await chromium.launch()
for (const file of (await readdir(resolve(htmlDir))).filter((f) =>
  f.endsWith(".html")
)) {
  const src = await readFile(resolve(htmlDir, file), "utf8")
  const width = Number(/width=(\d+)/.exec(src)?.[1] ?? 1440)
  const height = Number(/height:(\d+)px/.exec(src)?.[1] ?? 900)
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  })
  await page.goto(`file://${resolve(htmlDir, file)}`)
  await page.screenshot({ path: resolve(out, file.replace(/\.html$/, ".png")) })
  await page.close()
  console.log(`shot ${file} ${width}x${height}`)
}
await browser.close()
