import { afterEach, expect, it, vi } from "vitest"

import { onRequestError } from "@/instrumentation"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it.each(["nodejs", "edge"] as const)(
  "preserves the error boundary support reference in %s logs",
  async (runtime) => {
    vi.stubEnv("NEXT_RUNTIME", runtime)
    vi.stubEnv("SENTRY_DSN", "")
    const write = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = Object.assign(new Error("guest@example.test"), {
      digest: "next-support-reference",
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
      digest: "next-support-reference",
      error: { message: "[REDACTED_EMAIL]" },
    })
  }
)
