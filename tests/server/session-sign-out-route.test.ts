import { cookies } from "next/headers"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DELETE as signOut } from "@/app/api/session/route"
import { getDatabase } from "@/lib/server/db"

// DELETE /api/session answers truthfully: 204 only when what was asked for
// happened. A failed "everywhere" still signs this browser out (row deleted
// when possible, cookie always) and answers 503 sign_out_everywhere_failed.
// The DB-backed version lives in tests/integration/routes/auth.test.ts.

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))

let deleteCookie: ReturnType<typeof vi.fn>

/**
 * `revoke` answers the tagged `select revoke_user_sessions(...)`; `begin`
 * stands for both the session lookup and clearSession's own-row delete.
 */
function database({
  revoke,
  begin = async () => null,
}: {
  revoke: () => Promise<unknown>
  begin?: () => Promise<unknown>
}) {
  const sql = Object.assign(vi.fn(revoke), { begin: vi.fn(begin) })
  vi.mocked(getDatabase).mockReturnValue(sql as never)
  return sql
}

function request(path: string) {
  return new Request(`http://localhost${path}`, { method: "DELETE" })
}

const context = { params: Promise.resolve({}) }

beforeEach(() => {
  deleteCookie = vi.fn()
  vi.mocked(cookies).mockResolvedValue({
    get: () => ({ value: "token" }),
    delete: deleteCookie,
  } as never)
})

describe("DELETE /api/session", () => {
  it("answers 204 once every session is revoked", async () => {
    database({ revoke: async () => [{ revoked: 3 }] })
    const response = await signOut(request("/api/session?scope=all"), context)
    expect(response.status).toBe(204)
    expect(deleteCookie).toHaveBeenCalledWith("naba_session")
  })

  it("signs this browser out and says so when revoking everywhere fails", async () => {
    const sql = database({
      revoke: async () => {
        throw new Error("connection terminated")
      },
    })
    const response = await signOut(request("/api/session?scope=all"), context)
    expect(response.status).toBe(503)
    expect((await response.json()).error).toBe("sign_out_everywhere_failed")
    // Lookup, then clearSession's own-row delete.
    expect(sql.begin).toHaveBeenCalledTimes(2)
    expect(deleteCookie).toHaveBeenCalledWith("naba_session")
  })

  it("still drops the cookie when the local delete fails too", async () => {
    database({
      revoke: async () => {
        throw new Error("connection terminated")
      },
      begin: async () => {
        throw new Error("connection terminated")
      },
    })
    const response = await signOut(request("/api/session?scope=all"), context)
    expect(response.status).toBe(503)
    expect((await response.json()).error).toBe("sign_out_everywhere_failed")
    expect(deleteCookie).toHaveBeenCalledWith("naba_session")
  })

  it("reports a failed plain sign-out instead of answering 204", async () => {
    let calls = 0
    database({
      revoke: async () => [],
      // The first begin is the session lookup; the second is the delete.
      begin: async () => {
        calls += 1
        if (calls > 1) throw new Error("connection terminated")
        return null
      },
    })
    const response = await signOut(request("/api/session"), context)
    expect(response.status).toBe(500)
  })
})
