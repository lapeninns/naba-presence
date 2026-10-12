import "server-only"

import { getServerEnv } from "@/lib/server/env"

const SHA_PATTERN = /^[0-9a-f]{40}$/

export type ReleaseInfo = {
  /** The deployed commit, or "unknown" when nothing reliable says. */
  sha: string
  /**
   * Where the SHA came from. `naba_release_sha` is the value
   * `pnpm release:promote` stamps after checking the commit
   * (scripts/release/promote.mjs); `vercel_git_commit_sha` is Vercel's own
   * system variable, present for Git-integration deploys and unchecked.
   */
  source: "naba_release_sha" | "vercel_git_commit_sha" | "unknown"
}

/**
 * The commit this deployment runs. Operator-facing only: the platform health
 * scope reports it so a smoke check can compare it with the release receipt.
 */
export function releaseInfo(
  env: {
    NABA_RELEASE_SHA?: string
    VERCEL_GIT_COMMIT_SHA?: string
  } = {
    NABA_RELEASE_SHA: getServerEnv().NABA_RELEASE_SHA,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
  }
): ReleaseInfo {
  if (env.NABA_RELEASE_SHA && SHA_PATTERN.test(env.NABA_RELEASE_SHA)) {
    return { sha: env.NABA_RELEASE_SHA, source: "naba_release_sha" }
  }
  if (
    env.VERCEL_GIT_COMMIT_SHA &&
    SHA_PATTERN.test(env.VERCEL_GIT_COMMIT_SHA)
  ) {
    return { sha: env.VERCEL_GIT_COMMIT_SHA, source: "vercel_git_commit_sha" }
  }
  return { sha: "unknown", source: "unknown" }
}
