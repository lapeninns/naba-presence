// Static first-load client JS per App Router route, from a finished
// `pnpm build` (webpack). Next 16 no longer prints "First Load JS", so this
// derives it from the build manifests:
//
//   node tests/perf/route-js.mjs [--next .next] [--out <dir>] [--json]
//
// For every route's `page_client-reference-manifest.js` it takes the union
// of the chunks of every client module the route's server tree references
// (root/route-group layouts, error/not-found/loading boundaries and the page
// itself) plus `build-manifest.json` rootMainFiles (webpack runtime, React,
// Next client). Polyfills (nomodule) and chunks imported only through
// `next/dynamic`/`import()` are excluded: they are not first-load. Sizes are
// raw bytes and gzip -9 bytes of the emitted files.
//
// Caveat: Next merges the client manifests of related entries, so this is
// an UPPER BOUND (e.g. /sign-in lists the dashboard shell's chunks it never
// loads). perf-lab.mjs's firstLoadJsTransfer (chunks named by the served
// HTML) is the exact per-route figure; use this script for build-only
// checks and for every route, including ones the lab does not visit.
//
// Ceilings (gzip KB; exit 1 when exceeded):
//   --max-chunk 70     no single first-load chunk above this
//   --max-shared 200   chunks named by EVERY (dashboard) route (the shell)
//   --max-route 560    any route's union
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises"
import { gzipSync } from "node:zlib"
import { join, resolve, relative } from "node:path"
import { createRequire } from "node:module"

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const next = argv[index + 1]
  return next === undefined || next.startsWith("--") ? true : next
}
const nextDir = resolve(String(arg("next", ".next")))
const out = arg("out", null)
const require = createRequire(import.meta.url)

const build = JSON.parse(
  await readFile(join(nextDir, "build-manifest.json"), "utf8")
)
const rootMain = build.rootMainFiles

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.name === "page_client-reference-manifest.js") yield path
  }
}

const sizeCache = new Map()
async function size(file) {
  if (!sizeCache.has(file)) {
    const buffer = await readFile(join(nextDir, decodeURIComponent(file)))
    sizeCache.set(file, {
      raw: buffer.length,
      gzip: gzipSync(buffer, { level: 9 }).length,
    })
  }
  return sizeCache.get(file)
}

const routes = []
const chunkRoutes = new Map()
for await (const path of walk(join(nextDir, "server", "app"))) {
  globalThis.__RSC_MANIFEST = {}
  require(path)
  const [segment, manifest] = Object.entries(globalThis.__RSC_MANIFEST)[0]
  // "/(dashboard)/listings/[id]/page" -> "/listings/[id]"
  const route =
    segment
      .replace(/\/page$/, "")
      .replace(/\/\([^)]+\)/g, "")
      .replace(/^$/, "/") || "/"
  if (route.startsWith("/_")) continue
  const chunks = new Set(rootMain)
  for (const mod of Object.values(manifest.clientModules)) {
    if (mod.async) continue
    for (const chunk of mod.chunks) if (chunk.endsWith(".js")) chunks.add(chunk)
  }
  let raw = 0
  let gzip = 0
  for (const chunk of chunks) {
    const s = await size(chunk)
    raw += s.raw
    gzip += s.gzip
    if (!chunkRoutes.has(chunk)) chunkRoutes.set(chunk, new Set())
    chunkRoutes.get(chunk).add(route)
  }
  const css = new Set(
    Object.values(manifest.entryCSSFiles ?? {})
      .flat()
      .map((c) => c.path ?? c)
  )
  routes.push({
    route,
    segment,
    chunks: [...chunks].sort(),
    count: chunks.size,
    raw,
    gzip,
    css: [...css],
  })
}
routes.sort((a, b) => b.gzip - a.gzip)

const chunks = [...chunkRoutes.entries()]
  .map(([file, used]) => ({ file, ...sizeCache.get(file), routes: used.size }))
  .sort((a, b) => b.gzip - a.gzip)

const kb = (n) => (n / 1024).toFixed(1)
const lines = [
  "| Route | JS files | Raw KB | Gzip KB |",
  "| --- | ---: | ---: | ---: |",
  ...routes.map(
    (r) => `| ${r.route} | ${r.count} | ${kb(r.raw)} | ${kb(r.gzip)} |`
  ),
  "",
  `Routes analysed: ${routes.length}. Chunks used by >=1 route: ${chunks.length}.`,
  "",
  "| Chunk | Raw KB | Gzip KB | Routes using |",
  "| --- | ---: | ---: | ---: |",
  ...chunks
    .slice(0, 30)
    .map(
      (c) =>
        `| ${c.file.replace("static/chunks/", "")} | ${kb(c.raw)} | ${kb(c.gzip)} | ${c.routes} |`
    ),
]
// The authenticated shell: chunks every (dashboard) route references.
const dashboard = routes.filter((r) => r.segment.startsWith("/(dashboard)/"))
const shared = dashboard.length
  ? dashboard
      .map((r) => new Set(r.chunks))
      .reduce((a, b) => new Set([...a].filter((c) => b.has(c))))
  : new Set()
const sharedGzip = [...shared].reduce((s, c) => s + sizeCache.get(c).gzip, 0)
const sharedRaw = [...shared].reduce((s, c) => s + sizeCache.get(c).raw, 0)
lines.push(
  "",
  `Dashboard shell (chunks named by all ${dashboard.length} (dashboard) routes): ${shared.size} files, ${kb(sharedRaw)} KB raw, ${kb(sharedGzip)} KB gzip.`
)
const failures = []
const ceiling = (name) =>
  arg(name, null) === null ? null : Number(arg(name, null)) * 1024
const maxChunk = ceiling("max-chunk")
const maxShared = ceiling("max-shared")
const maxRoute = ceiling("max-route")
if (maxChunk !== null)
  for (const c of chunks)
    if (c.gzip > maxChunk)
      failures.push(`chunk ${c.file} ${kb(c.gzip)} KB gzip > ${kb(maxChunk)}`)
if (maxShared !== null && sharedGzip > maxShared)
  failures.push(`dashboard shell ${kb(sharedGzip)} KB gzip > ${kb(maxShared)}`)
if (maxRoute !== null)
  for (const r of routes)
    if (r.gzip > maxRoute)
      failures.push(`route ${r.route} ${kb(r.gzip)} KB gzip > ${kb(maxRoute)}`)
if (failures.length)
  lines.push(
    "",
    `**Ceiling breaches (${failures.length})**`,
    "",
    ...failures.map((f) => `- ${f}`)
  )

const result = {
  dashboardShell: {
    files: [...shared].sort(),
    raw: sharedRaw,
    gzip: sharedGzip,
  },
  failures,
  nextDir: relative(process.cwd(), nextDir),
  rootMain,
  routes,
  chunks,
}
if (out) {
  await mkdir(resolve(out), { recursive: true })
  await writeFile(
    join(resolve(out), "route-js.json"),
    JSON.stringify(result, null, 2)
  )
  await writeFile(join(resolve(out), "route-js.md"), lines.join("\n") + "\n")
}
console.log(arg("json", false) ? JSON.stringify(result) : lines.join("\n"))
if (failures.length) process.exitCode = 1
