import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiClientError, apiFetch } from "@/lib/api/client"
import {
  authErrorMessage,
  confirmStatusMessage,
  type AuthSurface,
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
      new ApiClientError(403, "email_not_verified", "server copy"),
      "sign-in"
    )
    expect(message.action).toBe("resend-confirmation")
    expect(message.title).not.toContain("email_not_verified")
  })

  it("maps invalid credentials without leaking which field was wrong", () => {
    const message = authErrorMessage(
      new ApiClientError(401, "invalid_credentials", "server copy"),
      "sign-in"
    )
    expect(message.title).toBe("That email or password is incorrect.")
    expect(message.action).toBeUndefined()
  })

  it("maps rate limiting and provider outages distinctly", () => {
    expect(
      authErrorMessage(
        new ApiClientError(429, "auth_rate_limited", "x"),
        "sign-in"
      ).title
    ).toBe("Too many attempts.")
    expect(
      authErrorMessage(
        new ApiClientError(503, "password_auth_disabled", "x"),
        "sign-in"
      ).title
    ).toBe("Sign-in is temporarily unavailable.")
  })

  it.each<[AuthSurface, string]>([
    ["sign-in", "Sign-in is temporarily unavailable."],
    ["create-account", "Account creation is temporarily unavailable."],
    ["forgot-password", "Password reset is temporarily unavailable."],
    ["reset-password", "Password reset is temporarily unavailable."],
    ["invitation", "Accepting invitations is temporarily unavailable."],
    ["mfa", "Two-step verification is temporarily unavailable."],
  ])("titles an outage for the %s surface", (surface, title) => {
    for (const code of [
      "password_auth_disabled",
      "auth_provider_unavailable",
    ]) {
      const message = authErrorMessage(
        new ApiClientError(503, code, "server copy"),
        surface
      )
      expect(message.title).toBe(title)
      expect(message.description).toBe(
        "This is a problem on our side. Try again shortly."
      )
    }
  })

  it("keeps every other code the same on every surface", () => {
    const surfaces: AuthSurface[] = [
      "sign-in",
      "create-account",
      "forgot-password",
      "reset-password",
      "invitation",
      "mfa",
    ]
    for (const code of [
      "invalid_credentials",
      "email_not_verified",
      "auth_rate_limited",
      "invalid_email_link",
      "password_reset_failed",
      "invitation_expired",
      "mfa_code_invalid",
    ]) {
      const [first, ...rest] = surfaces.map((surface) =>
        authErrorMessage(new ApiClientError(400, code, "x"), surface)
      )
      for (const other of rest) expect(other).toEqual(first)
    }
  })

  it("does not reveal whether an email has an account", () => {
    const message = authErrorMessage(
      new ApiClientError(401, "invalid_credentials", "server copy"),
      "sign-in"
    )
    expect(`${message.title} ${message.description}`).not.toMatch(
      /no account|not registered|does not exist|doesn.t exist/i
    )
  })

  it("never says agency, because the workspace mode is unknown before sign-in", () => {
    const codes = [
      "invitation_already_used",
      "invitation_expired",
      "invitation_not_found",
      "invitation_changed",
      "invitation_email_mismatch",
      "member_limit_reached",
      "invitation_scope_empty",
      "registration_closed",
      "sign_out_everywhere_failed",
    ]
    for (const code of codes) {
      expect(
        JSON.stringify(confirmStatusMessage(code)).toLowerCase()
      ).not.toContain("agency")
    }
  })

  it("tells an already-accepted invitation to sign in to continue", () => {
    const message = authErrorMessage(
      new ApiClientError(409, "invitation_already_used", "x"),
      "invitation"
    )
    expect(message.title).toBe("This invitation has already been accepted.")
    expect(message.description).toBe("Sign in to continue.")
  })

  it("falls back safely for unknown errors", () => {
    const message = authErrorMessage(new Error("boom"), "sign-in")
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

  it("titles a sign-in outage from the status by default", () => {
    expect(confirmStatusMessage("auth_provider_unavailable").title).toBe(
      "Sign-in is temporarily unavailable."
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
    expect(
      fieldErrorsFrom(new ApiClientError(500, "internal_error", "x"))
    ).toEqual({})
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
    await expect(
      apiFetch("/api/probe", { method: "DELETE" })
    ).resolves.toBeUndefined()
  })
})
