import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"

import { REQUEST_PATH_HEADER } from "@/lib/api/next-path"
import { config, proxy } from "@/proxy"

/**
 * R19: the proxy hands each page request's path + query to server code as a
 * REQUEST header, so flat-route shims and the dashboard layout can build
 * /sign-in?next=. It does no auth and issues no redirect.
 */

function matches(pathname: string): boolean {
  return config.matcher.some((pattern) =>
    new RegExp(`^${pattern}$`).test(pathname)
  )
}

const forwarded = (response: Response) =>
  response.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)

describe("proxy request-path header", () => {
  it("runs on every page route, never on APIs, internals or files", () => {
    for (const path of [
      "/",
      "/photos",
      "/profile/hours",
      "/settings/listing",
      "/auth/confirm",
      "/r/abcdefghjk",
      "/share/report/token",
      "/design-system",
    ]) {
      expect(matches(path), path).toBe(true)
    }
    for (const path of [
      "/api/health",
      "/_next/static/chunk.js",
      "/favicon.ico",
      "/robots.txt",
    ]) {
      expect(matches(path), path).toBe(false)
    }
  })

  it("forwards the path and query as a request header only", () => {
    const response = proxy(
      new NextRequest("http://localhost/photos?clientId=c-1&locationId=l-1")
    )
    expect(forwarded(response)).toBe("/photos?clientId=c-1&locationId=l-1")
    expect(response.headers.get("x-middleware-override-headers")).toContain(
      REQUEST_PATH_HEADER
    )
    expect(response.headers.get(REQUEST_PATH_HEADER)).toBeNull()
    expect(response.headers.get("x-middleware-next")).toBe("1")
    expect(response.headers.get("location")).toBeNull()
  })

  it("overwrites a value the client sent itself", () => {
    const response = proxy(
      new NextRequest("http://localhost/posts", {
        headers: { [REQUEST_PATH_HEADER]: "//evil.example" },
      })
    )
    expect(forwarded(response)).toBe("/posts")
  })
})
