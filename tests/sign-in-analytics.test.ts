import { describe, expect, it } from "vitest"

import {
  isAnalyticsEntry,
  signInAnalyticsId,
  signInReferrer,
} from "@/lib/analytics/sign-in"

describe("public sign-in analytics boundary", () => {
  it("allows only the production entry, including its accessibility skip link", () => {
    for (const url of [
      "https://nabapresence.com/sign-in",
      "https://nabapresence.com/sign-in#main",
    ]) {
      expect(isAnalyticsEntry(new URL(url))).toBe(true)
    }
  })

  it.each([
    "http://nabapresence.com/sign-in",
    "https://preview.vercel.app/sign-in",
    "https://nabapresence.com/sign-in?invite=example",
    "https://nabapresence.com/sign-in?next=%2Flistings%2Fexample",
    "https://nabapresence.com/sign-in#access_token=example",
    "https://nabapresence.com/sign-in/verify",
    "https://nabapresence.com/share/report/example",
    "https://nabapresence.com/inbox",
  ])("excludes %s", (url) => {
    expect(isAnalyticsEntry(new URL(url))).toBe(false)
  })

  it("sends only the external referring origin and drops same-site paths", () => {
    expect(signInReferrer("https://www.google.co.uk/search?q=test")).toBe(
      "https://www.google.co.uk"
    )
    expect(
      signInReferrer("https://nabapresence.com/share/report/example")
    ).toBeNull()
    expect(
      signInReferrer("https://www.nabapresence.com/invite/example")
    ).toBeNull()
    expect(signInReferrer("data:text/html,sensitive")).toBeNull()
  })

  it("fails closed with a missing or malformed stream ID", () => {
    expect(signInAnalyticsId(undefined)).toBeNull()
    expect(signInAnalyticsId("G-123&destination=example")).toBeNull()
    expect(signInAnalyticsId("G-1234567890")).toBe("G-1234567890")
  })
})
