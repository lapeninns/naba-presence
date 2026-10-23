import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  BUILD,
  SKIP,
  TEST_INPUT_DOCS,
  decide,
  isDocsOnlyFile,
} from "../../scripts/vercel-ignore-build.mjs"
import { readRepoText } from "../helpers/repo-text"

const preview = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feat/something",
  VERCEL_GIT_PREVIOUS_SHA: "aaa",
  VERCEL_GIT_COMMIT_SHA: "bbb",
}
const diff = (files: string[] | null) => () => files

describe("vercel-ignore-build", () => {
  it("is wired as vercel.json's ignoreCommand", () => {
    const vercelJson = JSON.parse(
      readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")
    ) as { ignoreCommand?: string }
    expect(vercelJson.ignoreCommand).toBe(
      "node scripts/vercel-ignore-build.mjs"
    )
  })

  it("never skips production, even for docs-only or Dependabot changes", () => {
    for (const env of [
      { ...preview, VERCEL_ENV: "production" },
      {
        ...preview,
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "dependabot/npm/x",
      },
    ]) {
      expect(decide(env, diff(["docs/ci.md"])).exitCode).toBe(BUILD)
    }
  })

  it("builds when the environment or the diff is uncertain", () => {
    expect(
      decide({ ...preview, VERCEL_ENV: undefined }, diff(["docs/a.md"]))
        .exitCode
    ).toBe(BUILD)
    expect(
      decide({ ...preview, VERCEL_ENV: "development" }, diff(["docs/a.md"]))
        .exitCode
    ).toBe(BUILD)
    expect(
      decide({ ...preview, VERCEL_GIT_PREVIOUS_SHA: "" }, diff(["docs/a.md"]))
        .exitCode
    ).toBe(BUILD)
    expect(decide(preview, diff(null)).exitCode).toBe(BUILD)
    expect(decide(preview, diff([])).exitCode).toBe(BUILD)
  })

  it("skips Dependabot preview branches", () => {
    const env = {
      ...preview,
      VERCEL_GIT_COMMIT_REF: "dependabot/npm_and_yarn/next-16.3.0",
    }
    expect(decide(env, diff(["package.json"])).exitCode).toBe(SKIP)
  })

  it("skips docs-only previews and builds anything else", () => {
    expect(
      decide(preview, diff(["docs/specs/plan.md", "lib/NOTES.md"])).exitCode
    ).toBe(SKIP)
    expect(
      decide(preview, diff(["docs/specs/plan.md", "lib/x.ts"])).exitCode
    ).toBe(BUILD)
    expect(decide(preview, diff(["AGENTS.md"])).exitCode).toBe(BUILD)
  })

  it("classifies files like ci.yml's plan job", () => {
    expect(isDocsOnlyFile("docs/specs/plan.md")).toBe(true)
    expect(isDocsOnlyFile("docs/evidence/shot.png")).toBe(true)
    expect(isDocsOnlyFile("components/README.md")).toBe(true)
    expect(isDocsOnlyFile("AGENTS.md")).toBe(false)
    expect(isDocsOnlyFile("lib/AGENTS.md")).toBe(false)
    expect(isDocsOnlyFile(".github/workflows/README.md")).toBe(false)
    expect(isDocsOnlyFile("scripts/ci/README.md")).toBe(false)
    expect(isDocsOnlyFile("supabase/README.md")).toBe(false)
    expect(isDocsOnlyFile("vercel.json")).toBe(false)
    // Docs that tests read are code: a change to one can fail `pnpm test`.
    expect(isDocsOnlyFile("docs/runbook.md")).toBe(false)
    expect(
      isDocsOnlyFile("docs/release/receipts/20261018T205153Z-45ae103a70a6.json")
    ).toBe(false)
    expect(isDocsOnlyFile("docs/release/decision-log.md")).toBe(false)
    expect(isDocsOnlyFile("docs/specs/plan.md")).toBe(true)
  })

  it("is the same rule as ci.yml's plan job and the pre-push hook", () => {
    const ci = readRepoText(".github/workflows/ci.yml")
    const hook = readRepoText(".githooks/pre-push")
    for (const entry of TEST_INPUT_DOCS) {
      const pattern = entry.endsWith("/") ? `${entry}*` : entry
      expect(ci, `ci.yml: ${pattern}`).toContain(pattern)
      expect(hook, `pre-push: ${pattern}`).toContain(pattern)
    }
    // Every doc the docs-path check reads is one of them.
    for (const doc of [
      "README.md",
      "docs/runbook.md",
      "docs/ci.md",
      "docs/architecture.md",
      "docs/frontend-backend-feature-map.md",
    ]) {
      expect(isDocsOnlyFile(doc), doc).toBe(false)
    }
    // Both names of a renamed file count.
    expect(ci).toContain(".previous_filename // empty")
    expect(hook).toContain("--no-renames")
    expect(readRepoText("scripts/vercel-ignore-build.mjs")).toContain(
      '"--no-renames"'
    )
  })
})
