import { describe, expect, it } from "vitest"

import { readRepoText } from "../helpers/repo-text"

const ruleset = JSON.parse(readRepoText(".github/rulesets/main.json"))

describe("approved local-ci merge protection", () => {
  it("requires the actual local aggregate without impersonating Actions", () => {
    const required = ruleset.rules.find(
      (rule: { type: string }) => rule.type === "required_status_checks"
    ).parameters
    expect(required.required_status_checks).toEqual([
      { context: "local-ci/release-gate" },
    ])
    expect(required.strict_required_status_checks_policy).toBe(true)
    expect(required.do_not_enforce_on_create).toBe(false)
  })

  it("preserves active default-branch protection and pull-request requirements", () => {
    expect(ruleset.enforcement).toBe("active")
    expect(ruleset.target).toBe("branch")
    expect(ruleset.conditions.ref_name).toEqual({
      include: ["~DEFAULT_BRANCH"],
      exclude: [],
    })
    for (const type of ["deletion", "non_fast_forward", "pull_request"])
      expect(ruleset.rules).toContainEqual(expect.objectContaining({ type }))
    const pullRequest = ruleset.rules.find(
      (rule: { type: string }) => rule.type === "pull_request"
    ).parameters
    expect(pullRequest.require_extra_approval_for_unattributed_changes).toBe(
      true
    )
    expect(pullRequest.required_approving_review_count).toBe(0)
    expect(ruleset.bypass_actors).toEqual([
      {
        actor_id: 5,
        actor_type: "RepositoryRole",
        bypass_mode: "pull_request",
      },
    ])
  })
})
