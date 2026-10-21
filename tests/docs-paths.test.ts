import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * Keeps the handoff documents honest about the files and `pnpm` commands they
 * cite: `docs/architecture.md` and `docs/frontend-backend-feature-map.md`,
 * plus the operator-facing `README.md`, `AGENTS.md`, `docs/runbook.md` and
 * `docs/ci.md`. They are read as a map of the codebase and as instructions to
 * run, so a backticked path that no longer resolves, or a `pnpm <name>` that
 * is not a script, sends the reader somewhere that does not exist.
 *
 * The job here is the citations, not the prose. The heuristic below is
 * deliberately conservative — it would rather ignore a real path than flag a
 * word that merely looks like one — so it only treats a backticked span as a
 * repository path when its first segment is a tracked top-level entry of the
 * repository. That single rule is what excludes URLs, npm package specifiers
 * (`@tanstack/react-query`), Google hostnames and API paths
 * (`mybusiness.googleapis.com/v4`), SQL identifiers, snake_case error codes,
 * HTTP header names and environment variable names, without a deny-list to
 * maintain. A deny-list is where a check like this rots.
 */

const repoRootPath = fileURLToPath(new URL("../", import.meta.url))

const DOCUMENTS = [
  "docs/architecture.md",
  "docs/frontend-backend-feature-map.md",
  "README.md",
  "AGENTS.md",
  "docs/runbook.md",
  "docs/ci.md",
] as const

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as {
  scripts: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/**
 * The top-level entry set comes from the git index, never from a directory
 * listing. A listing answers differently here than in CI: this working tree
 * carries `.next/`, `node_modules/`, `test-results/` and assorted scratch
 * directories, and a CI checkout carries none of them — `.github/workflows/
 * ci.yml` runs `pnpm test` before `pnpm build`, so there is no build output at
 * all when this test runs there. Under a listing-based rule a future citation
 * such as `.next/standalone/server.js` would be checked locally and silently
 * skipped in CI, and the non-vacuity floors below would absorb the
 * difference. Tracked files are the same set in both places.
 *
 * `actions/checkout@v4` performs a real clone, so `git ls-files` answers in CI
 * exactly as it does here. If it cannot answer, this throws rather than
 * falling back to a listing: a silent fallback would reintroduce the very
 * divergence the git index is here to remove.
 */
function trackedTopLevelEntries(): Set<string> {
  const listing = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRootPath,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  const entries = new Set(
    listing
      .split("\0")
      .filter(Boolean)
      .map((path) => path.split("/")[0])
  )
  if (entries.size === 0) {
    throw new Error(
      "`git ls-files` listed no tracked files, so every citation would be " +
        "skipped as a non-path. Refusing to run a vacuous check."
    )
  }
  return entries
}

const topLevelEntries = trackedTopLevelEntries()

type Citation = {
  doc: string
  line: number
  /** The span exactly as the document writes it. */
  token: string
  /** What is handed to `existsSync`, after expansion and normalisation. */
  tested: string
}

/** `a/{b,c}/d` → [`a/b/d`, `a/c/d`]; a token without braces is returned as is. */
function expandBraces(token: string): string[] {
  const match = /\{([^{}]*)\}/.exec(token)
  if (!match) return [token]
  const [group, alternatives] = match
  return alternatives
    .split(",")
    .flatMap((alternative) =>
      expandBraces(
        token.slice(0, match.index) +
          alternative.trim() +
          token.slice(match.index + group.length)
      )
    )
}

/**
 * Prose cites directories as globs: a trailing `/*` (`lib/api/*`), or a
 * mid-path wildcard segment (`app/api`, then a wildcard, then `route.ts`).
 * Test the literal prefix before the first glob segment — that is the
 * strongest claim such a token makes that a filesystem can answer. A trailing slash is
 * dropped for the same reason. Next.js dynamic segments (`[id]`) are left
 * alone: they exist literally on disk.
 */
function normalise(token: string): string {
  const segments = token.split("/")
  const firstGlob = segments.findIndex((segment) => /[*?]/.test(segment))
  const literal = firstGlob === -1 ? segments : segments.slice(0, firstGlob)
  return literal.join("/").replace(/\/+$/, "")
}

function isPathCandidate(token: string): boolean {
  if (!token.includes("/")) return false
  if (/^https?:\/\//.test(token)) return false
  if (token.startsWith("@")) return false
  // A space means prose, not a path: `GET /api/locations/[id]/activity`, or an
  // enum list such as `validating / validated / publishing`.
  if (/\s/.test(token)) return false
  return topLevelEntries.has(token.split("/")[0])
}

/**
 * What a document says in code: every backticked span outside a fence, and
 * every line inside one. Fenced lines are split into shell words so a command
 * such as `node scripts/ci/postgres.mjs start` yields its path.
 */
function codeSpans(
  text: string
): { line: number; span: string; fenced: boolean }[] {
  const spans: { line: number; span: string; fenced: boolean }[] = []
  let inFence = false
  text.split("\n").forEach((line, index) => {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence
      return
    }
    if (inFence) {
      spans.push({ line: index + 1, span: line, fenced: true })
      return
    }
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      spans.push({ line: index + 1, span: match[1].trim(), fenced: false })
    }
  })
  return spans
}

function readDocument(doc: string): string {
  return readFileSync(new URL(`../${doc}`, import.meta.url), "utf8")
}

/**
 * A backticked span is one claim, tested whole. A fenced line is a command,
 * so each shell word is tested instead.
 */
function pathTokens(span: string, fenced: boolean): string[] {
  if (!fenced) return isPathCandidate(span) ? [span] : []
  return span
    .split(/[\s"'=<>|;&()]+/)
    .map((word) => word.replace(/[,\\]+$/, ""))
    .filter(isPathCandidate)
}

function citations(): Citation[] {
  const found: Citation[] = []
  for (const doc of DOCUMENTS) {
    for (const { line, span, fenced } of codeSpans(readDocument(doc))) {
      for (const token of pathTokens(span, fenced)) {
        for (const expanded of expandBraces(token)) {
          const tested = normalise(expanded)
          if (tested) found.push({ doc, line, token, tested })
        }
      }
    }
  }
  return found
}

type ScriptReference = { doc: string; line: number; command: string }

/** Commands pnpm itself runs, which are not entries in `scripts`. */
const PNPM_BUILTINS = new Set([
  "add",
  "audit",
  "config",
  "create",
  "dlx",
  "env",
  "exec",
  "fetch",
  "i",
  "import",
  "init",
  "install",
  "link",
  "list",
  "ls",
  "outdated",
  "pack",
  "patch",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "rm",
  "run",
  "run-script",
  "store",
  "unlink",
  "up",
  "update",
  "why",
])

/** Global options that take a separate value: `pnpm --filter web build`. */
const PNPM_OPTIONS_WITH_VALUE = new Set(["-C", "--dir", "-F", "--filter"])

/**
 * The command a `pnpm ...` invocation runs, or null when `span` has none
 * (`pnpm` alone, or a word that only happens to follow the name in prose).
 * `pnpm run <name>` resolves to `<name>`.
 */
function pnpmCommand(words: string[]): string | null {
  let index = 0
  while (index < words.length && words[index].startsWith("-")) {
    index += PNPM_OPTIONS_WITH_VALUE.has(words[index]) ? 2 : 1
  }
  let command = words[index]
  if (!command || !/^[a-z][\w:.-]*$/.test(command)) return null
  if (command === "run" || command === "run-script") {
    index += 1
    while (index < words.length && words[index].startsWith("-")) index += 1
    command = words[index]
    if (!command || !/^[a-z][\w:.-]*$/.test(command)) return null
  }
  return command
}

function scriptReferences(): ScriptReference[] {
  const found: ScriptReference[] = []
  for (const doc of DOCUMENTS) {
    for (const { line, span } of codeSpans(readDocument(doc))) {
      for (const match of span.matchAll(
        /(?<![\w/.:-])pnpm(?=\s)([^|;&\n]*)/g
      )) {
        const command = pnpmCommand(
          match[1].trim().split(/\s+/).filter(Boolean)
        )
        if (command) found.push({ doc, line, command })
      }
    }
  }
  return found
}

/**
 * A `pnpm <name>` is real when it is a package script, a pnpm command, or a
 * dependency: pnpm runs an installed package's binary when no script matches
 * (`pnpm supabase link`).
 */
function isRunnableWithPnpm(command: string): boolean {
  if (command in packageJson.scripts) return true
  if (PNPM_BUILTINS.has(command)) return true
  return (
    command in (packageJson.dependencies ?? {}) ||
    command in (packageJson.devDependencies ?? {})
  )
}

describe("documentation paths", () => {
  const cited = citations()

  it("cites only files that exist", () => {
    const broken = cited
      .filter(({ tested }) => !existsSync(join(repoRootPath, tested)))
      .map(({ doc, line, token, tested }) =>
        token === tested
          ? `${doc}:${line} \`${token}\``
          : `${doc}:${line} \`${token}\` (tested ${tested})`
      )

    // One assertion listing every broken citation, so a stale document is
    // fixed in one pass rather than one failure at a time.
    expect(broken).toEqual([])
  })

  it("names only pnpm commands that exist", () => {
    const broken = scriptReferences()
      .filter(({ command }) => !isRunnableWithPnpm(command))
      .map(({ doc, line, command }) => `${doc}:${line} \`pnpm ${command}\``)
    expect(broken).toEqual([])
  })

  it("still finds the pnpm commands it is meant to check", () => {
    const references = scriptReferences()
    const scripts = new Set(
      references
        .map(({ command }) => command)
        .filter((command) => command in packageJson.scripts)
    )
    // Today: 114 references to 27 distinct scripts across the six documents.
    // The floors sit around 70% of that.
    expect(references.length).toBeGreaterThanOrEqual(80)
    expect(scripts.size).toBeGreaterThanOrEqual(18)
    for (const doc of ["README.md", "docs/runbook.md", "docs/ci.md"]) {
      expect(references.some((entry) => entry.doc === doc)).toBe(true)
    }
  })

  it("resolves pnpm invocations the way pnpm does", () => {
    const command = (text: string) =>
      pnpmCommand(text.split(/\s+/).filter(Boolean))
    expect(command("verify:release")).toBe("verify:release")
    expect(command("--filter web build")).toBe("build")
    expect(command("-C docs run lint")).toBe("lint")
    expect(command("run --silent test:e2e")).toBe("test:e2e")
    expect(command("exec playwright test")).toBe("exec")
    expect(command("--version")).toBeNull()
    expect(command("")).toBeNull()
    expect(command("Store")).toBeNull()
    // Existing, built-in and dependency commands pass; an invented one fails.
    expect(isRunnableWithPnpm("db:migrate")).toBe(true)
    expect(isRunnableWithPnpm("install")).toBe(true)
    expect(isRunnableWithPnpm("supabase")).toBe(true)
    expect(isRunnableWithPnpm("db:migrate-everything")).toBe(false)
    expect(isRunnableWithPnpm("format:check")).toBe(
      "format:check" in packageJson.scripts
    )
  })

  it("still finds the citations it is meant to check", () => {
    // Guards against a regex or heuristic change that silently matches
    // nothing. The six documents currently yield 514 citations across 312
    // distinct paths; the floors sit around 70% of that, low enough to
    // survive ordinary editing and high enough that a rule which collapses
    // to a near-empty set fails here rather than passing quietly.
    expect(cited.length).toBeGreaterThanOrEqual(360)
    expect(
      new Set(cited.map((entry) => entry.tested)).size
    ).toBeGreaterThanOrEqual(215)
    for (const doc of DOCUMENTS) {
      expect(cited.some((entry) => entry.doc === doc)).toBe(true)
    }
  })

  it("ignores spans that are not repository paths", () => {
    const tokens = new Set(cited.map((entry) => entry.token))
    for (const notAPath of [
      "@tanstack/react-query",
      "mybusiness.googleapis.com/v4",
      "GET /api/locations/[id]/activity",
      "https://example.test/a/b",
    ]) {
      expect(tokens.has(notAPath)).toBe(false)
      expect(isPathCandidate(notAPath)).toBe(false)
    }
  })

  it("derives its candidate rule from tracked files, not the local tree", () => {
    // The rule must answer identically in a fresh CI checkout, which has no
    // build output and none of this tree's scratch directories.
    for (const buildOutputOrScratch of [
      ".next",
      "node_modules",
      "test-results",
      "ds-bundle",
    ]) {
      expect(topLevelEntries.has(buildOutputOrScratch)).toBe(false)
    }
    // A sanity floor on the other side: the tracked entries genuinely cover
    // the directories the documents cite.
    for (const tracked of ["app", "lib", "components", "docs", "tests"]) {
      expect(topLevelEntries.has(tracked)).toBe(true)
    }
  })
})
