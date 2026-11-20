import { afterEach, expect, it, vi } from "vitest"

import { onRequestError } from "@/instrumentation"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it.each([
  ["nodejs", "next-support-reference", "next-support-reference"],
  ["edge", "next-support-reference", "next-support-reference"],
  ["nodejs", "1234567890", 1234567890],
  ["edge", "4294967295", 4294967295],
  ["nodejs", "guest@example.test", "[REDACTED_EMAIL]"],
  ["edge", "+1 (202) 555-0123", "[REDACTED_PHONE]"],
  ["nodejs", "4294967296", "[REDACTED_PHONE]"],
] as const)(
  "logs the %s support digest %s safely",
  async (runtime, digest, expectedDigest) => {
    vi.stubEnv("NEXT_RUNTIME", runtime)
    vi.stubEnv("SENTRY_DSN", "")
    const write = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = Object.assign(new Error("guest@example.test at 1234567890"), {
      digest,
    })
    await onRequestError(
      error,
      { path: "/dashboard", method: "GET", headers: {} },
      {
        routePath: "/dashboard",
        routeType: "render",
        routerKind: "App Router",
        renderSource: "react-server-components",
        revalidateReason: undefined,
      }
    )
    expect(JSON.parse(write.mock.calls[0][0])).toMatchObject({
      event: "next.request_error",
      digest: expectedDigest,
      error: { message: "[REDACTED_EMAIL] at [REDACTED_PHONE]" },
    })
  }
)
