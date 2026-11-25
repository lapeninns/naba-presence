import { execFileSync } from "node:child_process"

import {
  latestPromotedRelease,
  PROMOTION_RECEIPTS_DIR,
} from "./local-receipt.mjs"

export function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function promotionReceiptsAt(root, sha) {
  return git(root, "ls-tree", "--name-only", sha, `${PROMOTION_RECEIPTS_DIR}/`)
    .split("\n")
    .filter((path) => path.endsWith(".json"))
    .map((path) => ({
      name: path,
      content: git(root, "show", `${sha}:${path}`),
    }))
}

export function validateCandidateBase({ mergeCandidate, baseRef }, ciBaseSha) {
  if (!mergeCandidate) return
  if (!/^[0-9a-f]{40}$/.test(baseRef ?? "")) {
    throw new Error(
      "Merge candidate verification needs --base-ref <target SHA>"
    )
  }
  if (ciBaseSha && baseRef !== ciBaseSha) {
    throw new Error("--base-ref must match the CI target SHA")
  }
}

export function resolveGateBase(root, sha, { baseRef, mergeCandidate }) {
  let baseSource = "flag"
  if (!baseRef) {
    const previous = latestPromotedRelease(promotionReceiptsAt(root, sha))
    if (previous) {
      baseRef = previous.sha
      baseSource = "promotion-receipt"
    } else {
      baseRef = "origin/main"
      baseSource = "default"
      console.warn(
        "verify:release: no promotion receipt is committed, so the base is origin/main. For a release, pass --base-ref <the SHA production runs>."
      )
    }
  }
  let baseSha
  let mergeBase
  try {
    baseSha = git(root, "rev-parse", "--verify", `${baseRef}^{commit}`)
    mergeBase = git(root, "merge-base", baseSha, sha)
  } catch {
    throw new Error(
      `${baseRef} is not a commit with a merge base with HEAD; fetch it first.`
    )
  }
  if (mergeCandidate && (mergeBase !== baseSha || mergeBase === sha)) {
    throw new Error(
      "target base must be a strict ancestor of the merge candidate. Update the branch and verify its new head."
    )
  }
  if (mergeBase === sha) {
    console.warn(
      `verify:release: the merge base with ${baseRef} is HEAD itself, so migration-policy and migrate-upgrade compare HEAD with itself; promotion refuses this receipt.`
    )
  }
  return { baseRef, baseSha, mergeBase, baseSource }
}
