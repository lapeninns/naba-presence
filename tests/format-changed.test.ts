import { execFileSync, spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  FIX_COMMAND,
  hasFormattedExtension,
  parseArgs,
  selectFiles,
  splitNul,
} from "../scripts/format-changed.mjs"

const repoRoot = fileURLToPath(new URL("../", import.meta.url))
const script = join(repoRoot, "scripts/format-changed.mjs")
const hook = join(repoRoot, ".githooks/pre-push")

describe("parseArgs", () => {
  it("defaults to a check against the automatic base", () => {
    expect(parseArgs([])).toEqual({ mode: "check", base: null, help: false })
  })

  it("reads mode and base in either spelling", () => {
    expect(parseArgs(["--write", "--base", "abc123"])).toMatchObject({
      mode: "write",
      base: "abc123",
    })
    expect(parseArgs(["--check", "--base=origin/dev"])).toMatchObject({
      mode: "check",
      base: "origin/dev",
    })
  })

  it("rejects unknown flags and a base with no value", () => {
    expect(() => parseArgs(["--fix"])).toThrow(/unknown argument/)
    expect(() => parseArgs(["--base"])).toThrow(/--base needs/)
    expect(() => parseArgs(["--base", "--write"])).toThrow(/--base needs/)
    expect(() => parseArgs(["--base="])).toThrow(/--base needs/)
  })
})

describe("file selection", () => {
  const everything = { exists: () => true, isIgnored: () => false }

  it("keeps source types and drops everything else", () => {
    expect(
      selectFiles(
        [
          "app/page.tsx",
          "lib/a.ts",
          "scripts/x.mjs",
          "lib/b.mts",
          "docs/runbook.md",
          "package.json",
          "supabase/migrations/001.sql",
          "public/logo.webp",
          "Makefile",
          ".gitignore",
        ],
        everything
      )
    ).toEqual(["app/page.tsx", "lib/a.ts", "lib/b.mts", "scripts/x.mjs"])
  })

  it("decides by the final extension of the file name", () => {
    expect(hasFormattedExtension("a.d.ts")).toBe(true)
    expect(hasFormattedExtension("dir.ts/readme")).toBe(false)
    expect(hasFormattedExtension("ts")).toBe(false)
    expect(hasFormattedExtension(".ts")).toBe(false)
  })

  it("skips deleted files and ignored paths", () => {
    const present = new Set(["lib/kept.ts", "lib/ignored.ts"])
    expect(
      selectFiles(["lib/kept.ts", "lib/gone.ts", "lib/ignored.ts"], {
        exists: (path: string) => present.has(path),
        isIgnored: (path: string) => path === "lib/ignored.ts",
      })
    ).toEqual(["lib/kept.ts"])
  })

  it("returns each file once, sorted, whatever order git listed it", () => {
    expect(
      selectFiles(["b.ts", "a.ts", "b.ts", "", "a.ts"], everything)
    ).toEqual(["a.ts", "b.ts"])
  })

  it("splits NUL-separated git output, including paths with spaces", () => {
    expect(splitNul("a b.ts\0c.ts\0")).toEqual(["a b.ts", "c.ts"])
    expect(splitNul("")).toEqual([])
  })
})

describe("format-changed against a scratch repository", () => {
  let dir: string
  let baseSha: string

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim()
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const run = (...args: string[]) =>
    spawnSync("node", [script, ...args], { cwd: dir, encoding: "utf8" })

  const MESSY = "export const a   =   {b:1}\n"
  const NEAT = "export const a = { b: 1 }\n"

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "format-changed-"))
    git("init", "--quiet", "--initial-branch=main")
    git("config", "user.name", "Test")
    git("config", "user.email", "test@example.test")
    git("config", "commit.gpgsign", "false")
    put(".prettierrc", JSON.stringify({ semi: false }))
    put(".prettierignore", "generated/\n")
    // Messy files that exist at the base must never be reported.
    put("lib/legacy.ts", MESSY)
    put("lib/deleted.ts", MESSY)
    git("add", "-A")
    git("commit", "--quiet", "-m", "base")
    baseSha = git("rev-parse", "HEAD")
    git("switch", "--quiet", "-c", "feature")
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("passes when nothing changed, ignoring untouched messy files", () => {
    const result = run("--base", baseSha)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("0 changed files formatted")
  })

  it("reports committed, staged, unstaged and untracked files, and nothing else", () => {
    put("lib/committed.ts", MESSY)
    git("add", "-A")
    git("commit", "--quiet", "-m", "committed")
    put("lib/staged.ts", MESSY)
    git("add", "lib/staged.ts")
    put("lib/legacy.ts", `${MESSY}export const c   = 1\n`) // unstaged edit
    put("lib/untracked.tsx", MESSY)
    put("generated/out.ts", MESSY) // .prettierignore
    put("docs/notes.md", "#   not   checked\n") // not a formatted type
    put("lib/neat.ts", NEAT)
    rmSync(join(dir, "lib/deleted.ts"))

    const result = run("--base", baseSha)
    expect(result.status).toBe(1)
    const listed = result.stderr
      .split("\n")
      .filter((line) => line.startsWith("  "))
      .map((line) => line.trim())
    expect(listed).toEqual([
      "lib/committed.ts",
      "lib/legacy.ts",
      "lib/staged.ts",
      "lib/untracked.tsx",
    ])
    expect(result.stderr).toContain(`fix: ${FIX_COMMAND}`)
  })

  it("--write fixes exactly those files and a second check passes", () => {
    const written = run("--write", "--base", baseSha)
    expect(written.status).toBe(0)
    expect(written.stdout).toContain("formatted 4 files")
    expect(readFileSync(join(dir, "lib/committed.ts"), "utf8")).toBe(NEAT)
    expect(readFileSync(join(dir, "generated/out.ts"), "utf8")).toBe(MESSY)
    expect(run("--base", baseSha).status).toBe(0)
  })

  it("works in a clean detached worktree with no origin/main", () => {
    git("add", "-A")
    git("commit", "--quiet", "-m", "formatted")
    // A commit that is messy only in the branch tip.
    put("lib/late.ts", MESSY)
    git("add", "-A")
    git("commit", "--quiet", "-m", "late")
    const tip = git("rev-parse", "HEAD")
    const worktree = `${dir}-gate`
    git("worktree", "add", "--quiet", "--detach", worktree, tip)
    try {
      const result = spawnSync("node", [script, "--base", baseSha], {
        cwd: worktree,
        encoding: "utf8",
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("lib/late.ts")
      expect(result.stderr).not.toContain("lib/committed.ts")
    } finally {
      git("worktree", "remove", "--force", worktree)
    }
  })

  it("exits 2 with advice when no base can be resolved", () => {
    git("branch", "--move", "main", "trunk") // no origin/main, no main
    const missing = run()
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain("pass --base <sha>")
    const unknown = run("--base", "no-such-ref")
    expect(unknown.status).toBe(2)
    expect(unknown.stderr).toContain('cannot resolve base "no-such-ref"')
  })
})

describe("pre-push hook skip rules", () => {
  let dir: string
  let log: string
  let docsCommit: string
  let codeCommit: string
  let rootCommit: string
  const ZERO = "0".repeat(40)

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim()
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const commit = (message: string) => {
    git("add", "-A")
    git("commit", "--quiet", "-m", message)
    return git("rev-parse", "HEAD")
  }
  /** Runs the hook with git's stdin format and reports which checks ran. */
  const push = (stdin: string, env: Record<string, string> = {}) => {
    writeFileSync(log, "")
    const result = spawnSync("sh", [".githooks/pre-push"], {
      cwd: dir,
      encoding: "utf8",
      input: stdin,
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        HOME: dir,
        SKIP_VERIFY: "",
        ...env,
      },
    })
    const ran = readFileSync(log, "utf8").split("\n").filter(Boolean)
    return { status: result.status, ran, out: result.stdout + result.stderr }
  }
  const CHECKS = [
    "format-changed",
    "pnpm verify",
    "gitleaks git --no-banner --redact --log-opts=origin/main..HEAD .",
  ]
  const line = (local: string, remote: string) =>
    `refs/heads/feature ${local} refs/heads/feature ${remote}\n`

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "pre-push-"))
    log = join(dir, "calls.log")
    git("init", "--quiet", "--initial-branch=main")
    git("config", "user.name", "Test")
    git("config", "user.email", "test@example.test")
    git("config", "commit.gpgsign", "false")
    mkdirSync(join(dir, ".githooks"))
    copyFileSync(hook, join(dir, ".githooks/pre-push"))
    // Stubs record the checks instead of running them.
    mkdirSync(join(dir, "bin"))
    writeFileSync(
      join(dir, "bin/pnpm"),
      `#!/bin/sh\necho "pnpm $*" >> "${log}"\n`
    )
    chmodSync(join(dir, "bin/pnpm"), 0o755)
    writeFileSync(
      join(dir, "bin/gitleaks"),
      `#!/bin/sh\necho "gitleaks $*" >> "${log}"\n`
    )
    chmodSync(join(dir, "bin/gitleaks"), 0o755)
    mkdirSync(join(dir, "scripts"))
    writeFileSync(
      join(dir, "scripts/format-changed.mjs"),
      `import { appendFileSync } from "node:fs"\nappendFileSync("${log}", "format-changed\\n")\n`
    )
    put("README.md", "root\n")
    rootCommit = commit("root")
    git("update-ref", "refs/remotes/origin/main", rootCommit)
    put("docs/ci.md", "docs\n")
    put("lib/NOTES.md", "notes\n")
    docsCommit = commit("docs only")
    put("lib/code.ts", "export {}\n")
    codeCommit = commit("code")
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("skips a push that only deletes branches", () => {
    const result = push(`(delete) ${ZERO} refs/heads/old ${codeCommit}\n`)
    expect(result.status).toBe(0)
    expect(result.ran).toEqual([])
    expect(result.out).toContain("only deletes")
  })

  it("skips an update that only touches docs and markdown", () => {
    const result = push(line(docsCommit, rootCommit))
    expect(result.status).toBe(0)
    expect(result.ran).toEqual([])
    expect(result.out).toContain("only documentation")
  })

  it("skips a new branch whose commits are all documentation", () => {
    const result = push(line(docsCommit, ZERO))
    expect(result.ran).toEqual([])
  })

  it("runs verify and the format check when code changed", () => {
    const result = push(line(codeCommit, rootCommit))
    expect(result.status).toBe(0)
    expect(result.ran).toEqual(CHECKS)
  })

  it("does not treat AGENTS.md as documentation", () => {
    put("AGENTS.md", "rules\n")
    const agents = commit("agents")
    expect(push(line(agents, codeCommit)).ran).toEqual(CHECKS)
  })

  it("runs the checks when any one ref in the push needs them", () => {
    const result = push(
      `${line(docsCommit, rootCommit)}refs/heads/other ${codeCommit} refs/heads/other ${rootCommit}\n`
    )
    expect(result.ran).toEqual(CHECKS)
  })

  it("cannot tell what a push changes when the remote sha is unknown, so it runs", () => {
    const result = push(line(docsCommit, "1".repeat(40)))
    expect(result.ran).toEqual(CHECKS)
  })

  it("runs the checks when git gives it nothing to read", () => {
    expect(push("").ran).toEqual(CHECKS)
  })

  it("honours SKIP_VERIFY=1", () => {
    const result = push(line(codeCommit, rootCommit), { SKIP_VERIFY: "1" })
    expect(result.status).toBe(0)
    expect(result.ran).toEqual([])
    expect(result.out).toContain("SKIP_VERIFY=1")
  })

  it("fails the push when a check fails", () => {
    writeFileSync(
      join(dir, "bin/pnpm"),
      `#!/bin/sh\necho "pnpm $*" >> "${log}"\nexit 1\n`
    )
    const result = push(line(codeCommit, rootCommit))
    expect(result.status).not.toBe(0)
  })
})
