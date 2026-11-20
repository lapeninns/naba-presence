import { describe, expect, it } from "vitest"

import { GATE_STEPS } from "../../scripts/release/local-receipt.mjs"
import { readRepoText } from "../helpers/repo-text"

describe("local-ci quick-verify coverage by the full release gate", () => {
  it("keeps every quick verification boundary in the native gate", () => {
    const ids = GATE_STEPS.map((step) => step.id)
    for (const id of ["typecheck", "lint", "unit", "format", "design"])
      expect(ids).toContain(id)
    const scripts = JSON.parse(readRepoText("package.json")).scripts
    // `pnpm verify` is the gate's quick steps exactly (its design step runs
    // the ratchet and the contrast check), so it is the check to run before
    // handing a branch to local-ci.
    expect(scripts.verify).toBe(
      "pnpm typecheck && pnpm lint:gate && pnpm format:check && pnpm test && pnpm check:design --ratchet && pnpm check:contrast"
    )
    expect(scripts["lint:gate"]).toBe(
      "pnpm lint && pnpm check:quality && pnpm check:coverage && pnpm check:agents && pnpm check:openapi && pnpm release:notes"
    )
  })

  it("executes the same checks, not a weaker substitute", () => {
    const gate = readRepoText("scripts/release/verify-local.mjs")
    for (const command of [
      'must(sink, "pnpm", ["typecheck"])',
      'must(sink, "pnpm", ["lint:gate"])',
      'must(sink, "pnpm", ["test"],',
      '"scripts/format-changed.mjs",',
      '"--check",',
      'must(sink, "pnpm", ["check:design", "--ratchet"])',
      'must(sink, "pnpm", ["check:contrast"])',
    ])
      expect(gate).toContain(command)
  })
})
