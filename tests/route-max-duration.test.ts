import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * Every route that can reach Google or OpenAI declares its time budget
 * (W3-4 / W3-13, WP-04).
 *
 * A route file "reaches" a provider when its static (non type-only) imports,
 * followed transitively through the repo, arrive at the Google transport or
 * the OpenAI client. Such a route must export a literal `maxDuration` (Next
 * reads it at build time) and hand the same constant to each `route({...})`
 * it declares, so `ctx.deadline` (lib/server/deadline.ts) matches the limit
 * the platform will actually enforce. Without the export the platform
 * default applies and the deadline the services size their calls to is a
 * guess.
 */

const repoRoot = fileURLToPath(new URL("../", import.meta.url))

const PROVIDER_MODULES = new Set(
  ["lib/server/google/transport.ts", "lib/server/ai.ts"].map((path) =>
    join(repoRoot, path)
  )
)

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(path)
    return entry.name === "route.ts" ? [path] : []
  })
}

function resolveImport(specifier: string, from: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(repoRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(from), specifier)
      : null
  if (!base) return null
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

const importsCache = new Map<string, string[]>()

/** Runtime imports only: `import type` / `export type` erase at build. */
function runtimeImports(file: string): string[] {
  const cached = importsCache.get(file)
  if (cached) return cached
  const source = readFileSync(file, "utf8")
  const found: string[] = []
  for (const match of source.matchAll(
    /^\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm
  )) {
    if (match[1]) continue
    const resolved = resolveImport(match[2], file)
    if (resolved) found.push(resolved)
  }
  for (const match of source.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) {
    const resolved = resolveImport(match[1], file)
    if (resolved) found.push(resolved)
  }
  importsCache.set(file, found)
  return found
}

const reachCache = new Map<string, boolean>()

function reachesProvider(file: string, seen = new Set<string>()): boolean {
  if (PROVIDER_MODULES.has(file)) return true
  const cached = reachCache.get(file)
  if (cached !== undefined) return cached
  if (seen.has(file)) return false
  seen.add(file)
  const result = runtimeImports(file).some((dep) => reachesProvider(dep, seen))
  // Only a positive answer is safe to cache: a negative one may be an
  // artefact of the cycle guard above.
  if (result) reachCache.set(file, true)
  return result
}

const MAX_DURATION_EXPORT = /^export const maxDuration = \d+$/m

/** Each `route({...})` call's opening, up to its first property. */
function routeOpenings(source: string): string[] {
  return [...source.matchAll(/\broute(?:<[^>]*>)?\(\{\s*([^,\n]*)/g)].map(
    (match) => match[1].trim()
  )
}

describe("route time budgets", () => {
  const files = routeFiles(join(repoRoot, "app/api"))
  const providerRoutes = files.filter((file) => reachesProvider(file))

  it("finds the provider-reaching routes", () => {
    // A sanity floor: the scan must not silently match nothing.
    expect(providerRoutes.length).toBeGreaterThan(50)
    expect(providerRoutes.map((file) => relative(repoRoot, file))).toContain(
      "app/api/reviews/[id]/drafts/route.ts"
    )
  })

  it("every provider-reaching route exports a literal maxDuration", () => {
    const missing = providerRoutes
      .filter((file) => !MAX_DURATION_EXPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(repoRoot, file))
    expect(missing).toEqual([])
  })

  it("every route() in a file with maxDuration is handed it", () => {
    const unpassed = files.flatMap((file) => {
      const source = readFileSync(file, "utf8")
      if (!MAX_DURATION_EXPORT.test(source)) return []
      return routeOpenings(source)
        .filter((first) => first !== "maxDuration")
        .map(() => relative(repoRoot, file))
    })
    expect(unpassed).toEqual([])
  })
})
