import { describe, expect, it } from "vitest"

import {
  GUARDED_DATABASE_URL_VARS,
  assertLocalDatabaseUrl,
  assertLocalTestDatabases,
} from "../../scripts/run-test-command.mjs"

const remote = "postgresql://user:pass@db.example.supabase.co:5432/postgres"

describe("run-test-command database guard", () => {
  it("guards the runtime, admin and advisory-lock session URLs", () => {
    expect(GUARDED_DATABASE_URL_VARS).toEqual([
      "TEST_RUNTIME_DATABASE_URL",
      "DIRECT_DATABASE_URL",
      "DATABASE_SESSION_URL",
    ])
  })

  it.each([
    "postgresql://u:p@localhost:5432/db",
    "postgresql://u:p@127.0.0.1:54322/db",
    "postgresql://u:p@[::1]:5432/db",
    "postgresql://u:p@0.0.0.0:5432/db",
    "postgresql://u:p@pg.localhost:5432/db",
  ])("allows local URL %s", (url) => {
    for (const name of GUARDED_DATABASE_URL_VARS) {
      expect(() => assertLocalDatabaseUrl(name, { [name]: url })).not.toThrow()
    }
  })

  it("ignores unset variables", () => {
    expect(() => assertLocalTestDatabases({})).not.toThrow()
  })

  it.each(GUARDED_DATABASE_URL_VARS)("rejects a remote %s", (name) => {
    const env = {
      TEST_RUNTIME_DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      [name]: remote,
    }
    expect(() => assertLocalTestDatabases(env)).toThrow(
      new RegExp(`${name} points at non-local host "db.example.supabase.co"`)
    )
  })

  it("does not echo credentials in the error", () => {
    expect(() =>
      assertLocalDatabaseUrl("DATABASE_SESSION_URL", {
        DATABASE_SESSION_URL: remote,
      })
    ).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("pass") })
    )
  })

  it("rejects an unparseable URL", () => {
    expect(() =>
      assertLocalDatabaseUrl("DATABASE_SESSION_URL", {
        DATABASE_SESSION_URL: "not a url",
      })
    ).toThrow("DATABASE_SESSION_URL is not a parseable URL.")
  })

  it.each(GUARDED_DATABASE_URL_VARS)(
    "allows a remote %s only with ALLOW_REMOTE_TEST_DB=1",
    (name) => {
      expect(() =>
        assertLocalTestDatabases({ [name]: remote, ALLOW_REMOTE_TEST_DB: "1" })
      ).not.toThrow()
      expect(() =>
        assertLocalTestDatabases({
          [name]: remote,
          ALLOW_REMOTE_TEST_DB: "true",
        })
      ).toThrow()
    }
  )
})
