import { describe, expect, it } from "vitest"

import { signInPathFor } from "@/lib/api/next-path"

describe("signInPathFor", () => {
  it("keeps the requested path and query as ?next=", () => {
    expect(signInPathFor("/listings/abc/profile?tab=hours")).toBe(
      "/sign-in?next=%2Flistings%2Fabc%2Fprofile%3Ftab%3Dhours"
    )
  })

  it("falls back to a bare sign-in when there is nothing worth keeping", () => {
    expect(signInPathFor(null)).toBe("/sign-in")
    expect(signInPathFor("/")).toBe("/sign-in")
    expect(signInPathFor("/sign-in?next=/inbox")).toBe("/sign-in")
  })

  it("refuses off-site destinations smuggled through the header", () => {
    expect(signInPathFor("//evil.example/path")).toBe("/sign-in")
    expect(signInPathFor("/\\evil.example")).toBe("/sign-in")
    expect(signInPathFor("https://evil.example")).toBe("/sign-in")
  })
})
