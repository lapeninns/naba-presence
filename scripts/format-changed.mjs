#!/usr/bin/env node
// Formatting ratchet: checks (default) or writes Prettier formatting for the
// files this branch changed, not the whole tree. About 775 tracked ts/tsx
// files do not conform today, so a whole-tree check would fail at once; this
// one only asks that the files you touch are formatted.
//
//   node scripts/format-changed.mjs                 check, base = merge base with origin/main
//   node scripts/format-changed.mjs --write         rewrite the unformatted files
//   node scripts/format-changed.mjs --base <ref>    explicit base (a sha works in a detached worktree)
//
// "Changed" is everything that differs from the merge base of <base> and
// HEAD: commits, staged and unstaged edits, and untracked files that are not
// git-ignored. Deleted files are skipped, and so is anything .prettierignore
// excludes. Only source types listed in FORMATTED_EXTENSIONS are looked at;
// Markdown, JSON and YAML are deliberately outside the ratchet because they
// are mostly unformatted and are not covered by `pnpm format`.
//
// Exit codes: 0 formatted (or written), 1 unformatted files found,
// 2 could not run (no base, git or prettier failure).
//
// Dependency-free beyond the installed `prettier` (and the plugin its
// .prettierrc names).

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export const FORMATTED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]

export const FIX_COMMAND = "node scripts/format-changed.mjs --write"

const DEFAULT_BASES = ["origin/main", "main"]

/**
 * @param {string[]} argv
 * @returns {{ mode: "check" | "write", base: string | null, help: boolean }}
 */
export function parseArgs(argv) {
  let mode = "check"
  let base = null
  let help = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--check") mode = "check"
    else if (arg === "--write") mode = "write"
    else if (arg === "--help" || arg === "-h") help = true
    else if (arg === "--base") {
      base = argv[i + 1]
      i += 1
      if (!base || base.startsWith("--")) {
        throw new Error("--base needs a ref or sha")
      }
    } else if (arg.startsWith("--base=")) {
      base = arg.slice("--base=".length)
      if (!base) throw new Error("--base needs a ref or sha")
    } else {
      throw new Error(`unknown argument ${arg}`)
    }
  }
  return { mode, base, help }
}

export function hasFormattedExtension(file) {
  const name = file.slice(file.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return false
  return FORMATTED_EXTENSIONS.includes(name.slice(dot))
}

/**
 * Picks the files to format from the union of changed paths.
 *
 * @param {string[]} paths repo-relative paths from git, in any order, with duplicates
 * @param {{ exists: (path: string) => boolean, isIgnored: (path: string) => boolean }} probe
 * @returns {string[]} sorted, unique paths worth giving to Prettier
 */
export function selectFiles(paths, { exists, isIgnored }) {
  const selected = new Set()
  for (const path of paths) {
    if (!path || !hasFormattedExtension(path)) continue
    if (!exists(path)) continue // deleted, or a rename source
    if (isIgnored(path)) continue
    selected.add(path)
  }
  return [...selected].sort()
}

/** Splits NUL-separated git output. */
export function splitNul(output) {
  return output.split("\0").filter(Boolean)
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function tryGit(args, cwd) {
  try {
    return git(args, cwd).trim()
  } catch {
    return null
  }
}

/**
 * The commit to diff against: the merge base of the requested base and HEAD,
 * or the base itself when git cannot compute one (unrelated histories).
 * Returns null when nothing resolves.
 */
export function resolveBase(requested, cwd) {
  const candidates = requested ? [requested] : DEFAULT_BASES
  for (const candidate of candidates) {
    const commit = tryGit(
      ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`],
      cwd
    )
    if (!commit) continue
    return tryGit(["merge-base", commit, "HEAD"], cwd) ?? commit
  }
  return null
}

/** Paths that differ from `base` in the working tree, plus untracked ones. */
export function changedPaths(base, cwd) {
  const tracked = splitNul(
    git(["diff", "--name-only", "-z", "--diff-filter=ACMR", base], cwd)
  )
  const untracked = splitNul(
    git(["ls-files", "--others", "--exclude-standard", "-z"], cwd)
  )
  return [...tracked, ...untracked]
}

async function run(argv, cwd) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(
      "usage: node scripts/format-changed.mjs [--check | --write] [--base <ref-or-sha>]"
    )
    return 0
  }

  const root = git(["rev-parse", "--show-toplevel"], cwd).trim()
  const base = resolveBase(options.base, root)
  if (!base) {
    console.error(
      options.base
        ? `format-changed: cannot resolve base "${options.base}".`
        : `format-changed: neither ${DEFAULT_BASES.join(" nor ")} exists here; ` +
            "pass --base <sha>."
    )
    return 2
  }

  const prettier = await import("prettier")
  const ignorePath = resolve(root, ".prettierignore")
  const exists = (path) => existsSync(resolve(root, path))
  const files = selectFiles(changedPaths(base, root), {
    exists,
    isIgnored: () => false,
  })
  // `getFileInfo` is asynchronous, so it cannot be the synchronous probe
  // above: ask it once per candidate, then filter with the answers.
  const skipped = new Set()
  for (const path of files) {
    const info = await prettier.getFileInfo(resolve(root, path), {
      ignorePath,
      resolveConfig: true,
    })
    if (info.ignored || !info.inferredParser) skipped.add(path)
  }
  const candidates = selectFiles(files, {
    exists,
    isIgnored: (path) => skipped.has(path),
  })

  const unformatted = []
  for (const path of candidates) {
    const absolute = resolve(root, path)
    const source = readFileSync(absolute, "utf8")
    const config = (await prettier.resolveConfig(absolute)) ?? {}
    const options_ = { ...config, filepath: absolute }
    if (await prettier.check(source, options_)) continue
    unformatted.push(path)
    if (options.mode === "write") {
      writeFileSync(absolute, await prettier.format(source, options_))
    }
  }

  const noun = candidates.length === 1 ? "file" : "files"
  if (unformatted.length === 0) {
    console.log(
      `format-changed: ${candidates.length} changed ${noun} formatted`
    )
    return 0
  }
  if (options.mode === "write") {
    console.log(
      `format-changed: formatted ${unformatted.length} ${unformatted.length === 1 ? "file" : "files"}`
    )
    for (const path of unformatted) console.log(`  ${path}`)
    return 0
  }
  console.error(
    `format-changed: ${unformatted.length} of ${candidates.length} changed ${noun} not formatted:`
  )
  for (const path of unformatted) console.error(`  ${path}`)
  console.error(`fix: ${FIX_COMMAND}`)
  return 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run(process.argv.slice(2), process.cwd()).then(
    (code) => process.exit(code),
    (error) => {
      console.error(
        `format-changed: ${error instanceof Error ? error.message : error}`
      )
      process.exit(2)
    }
  )
}
