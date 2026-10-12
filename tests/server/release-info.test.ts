import { describe, expect, it } from "vitest"

import { serverEnvSchema } from "@/lib/server/env"
import { releaseInfo } from "@/lib/server/release"

const PROMOTED = "0123456789abcdef0123456789abcdef01234567"
const GIT = "89abcdef0123456789abcdef0123456789abcdef"

describe("releaseInfo", () => {
  it("prefers the SHA release:promote stamped", () => {
    expect(
      releaseInfo({ NABA_RELEASE_SHA: PROMOTED, VERCEL_GIT_COMMIT_SHA: GIT })
    ).toEqual({ sha: PROMOTED, source: "naba_release_sha" })
  })

  it("falls back to Vercel's Git commit SHA", () => {
    expect(releaseInfo({ VERCEL_GIT_COMMIT_SHA: GIT })).toEqual({
      sha: GIT,
      source: "vercel_git_commit_sha",
    })
  })

  it("says unknown rather than repeat something that is not a SHA", () => {
    expect(releaseInfo({})).toEqual({ sha: "unknown", source: "unknown" })
    expect(
      releaseInfo({ NABA_RELEASE_SHA: "main", VERCEL_GIT_COMMIT_SHA: "abc" })
    ).toEqual({ sha: "unknown", source: "unknown" })
  })

  it("validates NABA_RELEASE_SHA as a full lowercase SHA, empty as unset", () => {
    const field = serverEnvSchema.shape.NABA_RELEASE_SHA
    expect(field.parse(PROMOTED)).toBe(PROMOTED)
    expect(field.parse("")).toBeUndefined()
    expect(field.parse(undefined)).toBeUndefined()
    expect(field.safeParse(PROMOTED.slice(0, 12)).success).toBe(false)
    expect(field.safeParse(PROMOTED.toUpperCase()).success).toBe(false)
  })
})
