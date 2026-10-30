import { NextRequest } from "next/server"
import { describe, expect, it, vi } from "vitest"

import { config, proxy } from "@/proxy"

// The public review link (/r/<code>) must reach its route handler untouched:
// the proxy does no auth, so a guest with no session cookie is never sent to
// sign-in on the way to Google's review form.

const URL_WITH_QR = "http://localhost/r/abcdefghjk?s=qr"

function matches(pathname: string): boolean {
  return config.matcher.some((pattern) =>
    new RegExp(`^${pattern}$`).test(pathname)
  )
}

describe("proxy and /r/<code>", () => {
  it("is in the proxy's matcher, so the pass-through below is what runs", () => {
    expect(matches("/r/abcdefghjk")).toBe(true)
  })

  it("passes the request through with no redirect", () => {
    const response = proxy(new NextRequest(URL_WITH_QR))
    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("location")).toBeNull()
    expect(response.headers.get("x-middleware-rewrite")).toBeNull()
    expect(response.status).not.toBe(401)
    expect(response.status < 300 || response.status >= 400).toBe(true)
  })

  it("never reads a session cookie (a guest has none)", () => {
    const request = new NextRequest(URL_WITH_QR)
    const get = vi.spyOn(request.cookies, "get")
    const getAll = vi.spyOn(request.cookies, "getAll")
    const has = vi.spyOn(request.cookies, "has")
    expect(request.headers.get("cookie")).toBeNull()

    const response = proxy(request)

    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("location")).toBeNull()
    expect(get).not.toHaveBeenCalled()
    expect(getAll).not.toHaveBeenCalled()
    expect(has).not.toHaveBeenCalled()
    expect(response.headers.get("set-cookie")).toBeNull()
  })
})
