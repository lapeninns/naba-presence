import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  DOCS_ONLY,
  FAST_PATH_NOTE,
  FAST_PATH_STEPS,
  changedFilesBetween,
  chooseGatePath,
  fastPathProblems,
  isFastPathFile,
} from "../../scripts/release/fast-path.mjs"
import {
  GATE_SOURCE_PATHS,
  GATE_STEPS,
  LOCAL_RECEIPT_KIND,
  LOCAL_RECEIPT_VERSION,
  localReceiptProblems,
} from "../../scripts/release/local-receipt.mjs"
import { parseArgs } from "../../scripts/release/verify-local.mjs"

const pr = (files: string[] | null) =>
  chooseGatePath({ baseRefGiven: true, full: false, files })

describe("docs-only fast path: which files", () => {
  it("lets through documentation nothing in the gate reads", () => {
    for (const file of [
      "docs/specs/plan.md",
      "docs/audits/2026-11-20/notes.md",
      "docs/evidence/shot.png",
      "components/README.md",
      "lib/NOTES.md",
    ])
      expect(isFastPathFile(file), file).toBe(true)
  })

  it("treats docs the gate, tests or promotion read, and anything unknown, as code", () => {
    for (const file of [
      // Read by tests (vercel-ignore-build TEST_INPUT_DOCS) or agents.
      "AGENTS.md",
      "lib/AGENTS.md",
      "README.md",
      "docs/ci.md",
      "docs/runbook.md",
      "docs/architecture.md",
      "docs/frontend-backend-feature-map.md",
      // Read by the gate and by promotion.
      "docs/release/receipts/20261119T162122Z-e85bc8edefd9.json",
      "docs/release/receipts/README.md",
      "docs/release/decision-log.md",
      // Code or data that happens to live under docs/.
      "docs/redesign/2026-11/check-inventory.mjs",
      "docs/data.json",
      "docs/page.html",
      // Dot-folders and the gate's own folders.
      ".design-sync/conventions.md",
      ".github/workflows/README.md",
      "scripts/ci/README.md",
      "supabase/README.md",
      // Not documentation at all.
      "lib/server/env.ts",
      "package.json",
      "",
    ])
      expect(isFastPathFile(file), file || "(empty)").toBe(false)
  })

  it("covers every tracked doc that a source file names in quotes", () => {
    // A doc that code, a test or a config names as a path (as a string) may
    // be read by it, so a change to it must run the full gate. Fixture names
    // in tests (docs/specs/plan.md) are not tracked files and do not count.
    const repo = join(dirname(new URL(import.meta.url).pathname), "../..")
    const tracked = new Set(
      execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" })
        .trim()
        .split("\n")
    )
    const sources = [...tracked].filter(
      (file) =>
        /\.(ts|tsx|mjs|js|cjs|sh|json|ya?ml)$/.test(file) &&
        !file.startsWith("docs/") &&
        !file.startsWith("public/")
    )
    const named: string[] = []
    for (const source of sources) {
      const text = readFileSync(join(repo, source), "utf8")
      for (const match of text.matchAll(
        /["'`]((?:\.\.?\/)*(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+)["'`]/g
      )) {
        const path = match[1].replace(/^(\.\.?\/)+/, "")
        if (tracked.has(path) && isFastPathFile(path))
          named.push(`${path} <- ${source}`)
      }
    }
    expect(named).toEqual([])
  })
})

describe("docs-only fast path: which gate", () => {
  it("takes the fast path only for a pull request whose every file is inert documentation", () => {
    expect(pr(["docs/specs/plan.md", "lib/NOTES.md"]).path).toBe(DOCS_ONLY)
    // Controlled case: one code file among docs runs the full gate.
    expect(pr(["docs/specs/plan.md", "lib/server/env.ts"])).toMatchObject({
      path: "full",
      reason: expect.stringContaining("lib/server/env.ts"),
    })
    // Controlled case: a receipt (read by the gate and by promotion).
    expect(
      pr([
        "docs/specs/plan.md",
        "docs/release/receipts/20261119T162122Z-e85bc8edefd9.json",
      ]).path
    ).toBe("full")
    expect(pr(["AGENTS.md"]).path).toBe("full")
    // Fail safe: nothing to compare, or git could not tell.
    expect(pr([]).path).toBe("full")
    expect(pr(null).path).toBe("full")
    // Not a pull request (a release run) or asked for in full.
    expect(
      chooseGatePath({
        baseRefGiven: false,
        full: false,
        files: ["docs/a.md"],
      }).path
    ).toBe("full")
    expect(
      chooseGatePath({ baseRefGiven: true, full: true, files: ["docs/a.md"] })
        .path
    ).toBe("full")
  })

  it("parses --full and NABA_GATE_FULL", () => {
    expect(parseArgs([]).full).toBe(false)
    expect(parseArgs(["--full"]).full).toBe(true)
    expect(parseArgs([], { NABA_GATE_FULL: "1" }).full).toBe(true)
  })

  describe("on real commits", () => {
    const repo = mkdtempSync(join(tmpdir(), "naba-fast-path-"))
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim()
    const commit = (files: Record<string, string>, message: string) => {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(repo, path)), { recursive: true })
        writeFileSync(join(repo, path), text)
      }
      git("add", "-A")
      git("commit", "-qm", message)
      return git("rev-parse", "HEAD")
    }
    git("init", "-q")
    git("config", "user.email", "test@example.invalid")
    git("config", "user.name", "test")
    const base = commit(
      { "lib/x.ts": "export const x = 1\n", "docs/notes.md": "a\n" },
      "base"
    )
    afterAll(() => rmSync(repo, { recursive: true, force: true }))

    const pathFrom = (from: string, to: string) =>
      pr(changedFilesBetween(repo, from, to)).path

    it("docs only", () => {
      const head = commit({ "docs/notes.md": "b\n" }, "docs")
      expect(pathFrom(base, head)).toBe(DOCS_ONLY)
    })

    it("a non-docs change takes the full gate", () => {
      const from = git("rev-parse", "HEAD")
      const head = commit(
        { "docs/notes.md": "c\n", "lib/x.ts": "export const x = 2\n" },
        "mixed"
      )
      expect(pathFrom(from, head)).toBe("full")
    })

    it("a receipts change takes the full gate", () => {
      const from = git("rev-parse", "HEAD")
      const head = commit(
        {
          "docs/release/receipts/20261120T000000Z-0123456789ab.json": "{}\n",
        },
        "receipt"
      )
      expect(pathFrom(from, head)).toBe("full")
    })

    it("moving code into docs/ takes the full gate (both names count)", () => {
      const from = git("rev-parse", "HEAD")
      git("mv", "lib/x.ts", "docs/x.md")
      git("commit", "-qm", "rename")
      expect(changedFilesBetween(repo, from, "HEAD")).toEqual([
        "docs/x.md",
        "lib/x.ts",
      ])
      expect(pathFrom(from, git("rev-parse", "HEAD"))).toBe("full")
    })

    it("an unknown commit fails safe", () => {
      expect(changedFilesBetween(repo, "0".repeat(40), "HEAD")).toBeNull()
    })
  })
})

describe("docs-only fast path: verdict and receipt", () => {
  const ids = GATE_STEPS.map((step: { id: string }) => step.id)
  const fastRun = (overrides: Record<string, object> = {}) =>
    ids.map((id: string) => ({
      id,
      ...(FAST_PATH_STEPS.includes(id)
        ? { status: "passed" }
        : { status: "skipped", note: FAST_PATH_NOTE }),
      ...overrides[id],
    }))

  it("passes only when the fast steps passed and every other step was skipped by it", () => {
    expect(fastPathProblems(fastRun(), ids)).toEqual([])
    // Workflow lint may be skipped where its tools are missing, as in the full gate.
    expect(
      fastPathProblems(
        fastRun({ "workflow-lint": { status: "skipped", note: "no tools" } }),
        ids
      )
    ).toEqual([])
    expect(
      fastPathProblems(fastRun({ format: { status: "failed" } }), ids)
    ).toEqual(['fast-path step "format" failed'])
    expect(
      fastPathProblems(fastRun({ "secret-scan": { status: "skipped" } }), ids)
    ).toEqual(['fast-path step "secret-scan" skipped'])
    expect(
      fastPathProblems(fastRun({ unit: { status: "passed", note: "" } }), ids)
    ).toEqual([
      'step "unit" should have been skipped by the fast path, but is passed',
    ])
    expect(fastPathProblems(fastRun().slice(1), ids)).toEqual([
      `step "${ids[0]}" is missing`,
    ])
  })

  it("never lets promotion accept a fast-path receipt", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567"
    const receipt = {
      kind: LOCAL_RECEIPT_KIND,
      version: LOCAL_RECEIPT_VERSION,
      sha,
      mode: "worktree",
      base: { sha: "f".repeat(40), mergeBase: "e".repeat(40) },
      gateSource: { clean: true, changed: [] },
      toolchain: { node: "v24.18.0" },
      options: {
        skip: [],
        gatePath: DOCS_ONLY,
        gatePathReason: "all 1 changed file(s) are documentation",
      },
      ok: false,
      steps: fastRun(),
    }
    const problems = localReceiptProblems(receipt, { sha, nodeMajor: 24 })
    expect(problems).toContain(
      "the local gate took the docs-only fast path (all 1 changed file(s) are documentation); a release needs the full gate"
    )
    expect(
      problems.some((p: string) => /required step "unit" skipped/.test(p))
    ).toBe(true)
  })

  it("counts the rule it reuses as gate code", () => {
    expect(GATE_SOURCE_PATHS).toContain("scripts/vercel-ignore-build.mjs")
  })
})
