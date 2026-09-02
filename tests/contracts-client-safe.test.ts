/**
 * Every lib/contracts/*.ts module must be safe to bundle for the browser:
 * walking its value-import graph (through lib/domain, lib/errors, ...) must
 * never reach `server-only`, a Node builtin (`node:crypto`, `fs`, ...) or
 * lib/server. Type-only imports are erased at build time and are skipped.
 *
 * The domain convention this enforces is documented in lib/domain/README.md:
 * hashing modules are server-only; contracts import from *-vocabulary.ts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { builtinModules } from "node:module"
import { dirname, join, relative, resolve } from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
const CONTRACTS_DIR = join(ROOT, "lib", "contracts")
const NODE_BUILTINS = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`])
)

/**
 * Value import/re-export specifiers of one source file. `import type` and
 * `export type` statements are erased by the compiler, so they are not
 * followed; `import { type X }` inside a value import still loads the module
 * under isolatedModules and is followed.
 */
export function valueImportSpecifiers(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
  const specifiers: string[] = []
  const statement =
    /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g
  for (const match of withoutComments.matchAll(statement)) {
    const [, , typeOnly, specifier] = match
    if (typeOnly) continue
    specifiers.push(specifier)
  }
  return specifiers
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2))
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier)
  else return null // bare package: not part of the repo graph
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  throw new Error(`Cannot resolve "${specifier}" from ${relative(ROOT, fromFile)}`)
}

type Violation = { file: string; specifier: string; via: string[] }

/** Walks the value-import graph from `entry` and returns every unsafe edge. */
export function findServerOnlyImports(entry: string): Violation[] {
  const violations: Violation[] = []
  const seen = new Set<string>()
  const walk = (file: string, via: string[]) => {
    if (seen.has(file)) return
    seen.add(file)
    const source = readFileSync(file, "utf8")
    for (const specifier of valueImportSpecifiers(source)) {
      const unsafe =
        specifier === "server-only" ||
        NODE_BUILTINS.has(specifier) ||
        specifier.startsWith("@/lib/server/") ||
        specifier === "@/lib/server"
      if (unsafe) {
        violations.push({ file: relative(ROOT, file), specifier, via })
        continue
      }
      const next = resolveSpecifier(file, specifier)
      if (next) walk(next, [...via, relative(ROOT, file)])
    }
  }
  walk(entry, [])
  return violations
}

const contractFiles = readdirSync(CONTRACTS_DIR)
  .filter((name) => name.endsWith(".ts"))
  .sort()

describe("lib/contracts stay client-safe", () => {
  it("covers every contract module", () => {
    expect(contractFiles.length).toBeGreaterThan(0)
  })

  it.each(contractFiles)(
    "lib/contracts/%s reaches no server-only, node:* or lib/server import",
    (name) => {
      expect(findServerOnlyImports(join(CONTRACTS_DIR, name))).toEqual([])
    }
  )
})

describe("the walker itself", () => {
  it("follows value imports and skips erased type-only imports", () => {
    expect(
      valueImportSpecifiers(`
        import { z } from "zod"
        import type { Only } from "@/lib/domain/hours"
        import { a, type B } from "@/lib/domain/hours-vocabulary"
        export type { T } from "@/lib/domain/profile"
        export { v } from "@/lib/domain/profile-vocabulary"
        export * from "@/lib/domain/import-review-vocabulary"
        import "server-only"
        // import { nope } from "node:fs"
        /* import { nope } from "node:path" */
      `)
    ).toEqual([
      "zod",
      "@/lib/domain/hours-vocabulary",
      "@/lib/domain/profile-vocabulary",
      "@/lib/domain/import-review-vocabulary",
      "server-only",
    ])
  })

  it("detects node:crypto behind the domain hashing modules", () => {
    // The hashing modules are the documented server-only boundary; the walker
    // must see through them or the contract assertions above prove nothing.
    for (const name of ["hours", "profile", "food-menus"]) {
      const hits = findServerOnlyImports(join(ROOT, "lib", "domain", `${name}.ts`))
      expect(hits.map((hit) => hit.specifier)).toContain("node:crypto")
    }
  })

  it("sees the vocabulary modules as clean", () => {
    for (const name of [
      "hours-vocabulary",
      "profile-vocabulary",
      "food-menus-vocabulary",
      "import-review-vocabulary",
      "import-review",
      "food-menu-import",
    ]) {
      expect(findServerOnlyImports(join(ROOT, "lib", "domain", `${name}.ts`))).toEqual([])
    }
  })
})
