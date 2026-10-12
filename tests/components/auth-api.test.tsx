import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiClientError, apiFetch } from "@/lib/api/client"
import {
  authErrorMessage,
  confirmStatusMessage,
  fieldErrorsFrom,
} from "@/lib/api/auth-errors"
import { sanitiseNextPath } from "@/lib/api/next-path"
import { signedOutHereOnly, signOut } from "@/lib/api/auth"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("sanitiseNextPath", () => {
  it("accepts same-site absolute paths", () => {
    expect(sanitiseNextPath("/inbox?queue=needs_reply")).toBe(
      "/inbox?queue=needs_reply"
    )
  })
  it("rejects anything that could leave the site", () => {
    for (const value of [
      null,
      undefined,
      "",
      "inbox",
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "javascript:alert(1)",
    ]) {
      expect(sanitiseNextPath(value)).toBeNull()
    }
  })
  it("rejects control-character-smuggled protocol-relative bypasses", () => {
    // Browsers strip \t/\n/\r from a URL before parsing, so these values
    // would otherwise reach window.location.assign as "//evil.com" and
    // navigate off-site. The WHATWG URL parser strips them the same way,
    // so the origin check below catches them before the old prefix-check
    // guard would have let them through.
    for (const value of [
      "/\n//evil.com",
      "/\t//evil.com",
      "/\r//evil.com",
      "/\n/evil.com",
    ]) {
      expect(sanitiseNextPath(value)).toBeNull()
    }
  })
})

describe("authErrorMessage", () => {
  it("offers a resend action for unconfirmed accounts", () => {
    const message = authErrorMessage(
      new ApiClientError(403, "email_not_verified", "server copy")
    )
    expect(message.action).toBe("resend-confirmation")
    expect(message.title).not.toContain("email_not_verified")
  })

  it("maps invalid credentials without leaking which field was wrong", () => {
    const message = authErrorMessage(
      new ApiClientError(401, "invalid_credentials", "server copy")
    )
    expect(message.title).toBe("That email or password is incorrect.")
    expect(message.action).toBeUndefined()
  })

  it("maps rate limiting and provider outages distinctly", () => {
    expect(
      authErrorMessage(new ApiClientError(429, "auth_rate_limited", "x")).title
    ).toBe("Too many attempts.")
    expect(
      authErrorMessage(
        new ApiClientError(503, "password_auth_disabled", "x")
      ).title
    ).toBe("Sign-in is temporarily unavailable.")
  })

  it("falls back safely for unknown errors", () => {
    const message = authErrorMessage(new Error("boom"))
    expect(message.title).toBe("Something went wrong.")
    expect(JSON.stringify(message)).not.toContain("boom")
  })
})

describe("confirmStatusMessage", () => {
  it("distinguishes an expired invitation from a bad link", () => {
    expect(confirmStatusMessage("invitation_expired").title).toBe(
      "That invitation has expired."
    )
    expect(confirmStatusMessage("invalid_email_link").title).toBe(
      "That link is invalid or has expired."
    )
    expect(confirmStatusMessage("anything-else").title).toBe(
      "That link is invalid or has expired."
    )
  })
})

describe("fieldErrorsFrom", () => {
  it("maps zod issue paths to field messages", () => {
    const error = new ApiClientError(400, "invalid_request", "x", [
      { path: ["password"], message: "Include at least one number." },
      { path: ["password"], message: "later duplicate" },
      { path: ["email"], message: "Enter a valid email address." },
    ])
    expect(fieldErrorsFrom(error)).toEqual({
      password: "Include at least one number.",
      email: "Enter a valid email address.",
    })
  })
  it("returns nothing for other errors", () => {
    expect(fieldErrorsFrom(new ApiClientError(500, "internal_error", "x"))).toEqual({})
  })
})

describe("signOut", () => {
  it("resolves on a 204 with no body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    )
    await expect(signOut()).resolves.toBeUndefined()
  })

  it("rejects on a server error instead of reporting success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "internal_error" }, { status: 500 })
      )
    )
    const error = await signOut().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(signedOutHereOnly(error)).toBe(false)
  })

  it("marks a partial sign-out everywhere as signed out here only", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "sign_out_everywhere_failed" }, { status: 503 })
    )
    vi.stubGlobal("fetch", fetchMock)
    const error = await signOut({ everywhere: true }).catch(
      (caught: unknown) => caught
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/session?scope=all",
      expect.objectContaining({ method: "DELETE" })
    )
    expect(signedOutHereOnly(error)).toBe(true)
    expect(signedOutHereOnly(new Error("offline"))).toBe(false)
  })
})

describe("sign_out_everywhere_failed status", () => {
  it("tells the sign-in page other devices may still be signed in", () => {
    const message = confirmStatusMessage("sign_out_everywhere_failed")
    expect(message.title).toBe("You’re signed out on this device.")
    expect(message.description).toMatch(/other devices may still be signed in/)
  })
})

describe("apiFetch 204", () => {
  it("returns undefined instead of an empty string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    )
    await expect(apiFetch("/api/probe", { method: "DELETE" })).resolves.toBeUndefined()
  })
})
