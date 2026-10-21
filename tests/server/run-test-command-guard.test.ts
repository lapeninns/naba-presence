import { spawnSync } from "node:child_process"
import { createServer } from "node:net"

import { describe, expect, it } from "vitest"

import {
  GUARDED_DATABASE_URL_VARS,
  assertLocalDatabaseUrl,
  assertLocalTestDatabases,
  chooseTestDatabase,
  parseExports,
} from "../../scripts/run-test-command.mjs"
import {
  DISPOSABLE_MARKER,
  SUPABASE_DEV_DB_PORT,
  disposableDatabaseEnv,
  runtimeUrlFor,
  urlsMatchDisposableMarker,
} from "../../scripts/test-database.mjs"

const remote = "postgresql://user:pass@db.example.supabase.co:5432/postgres"
const devDatabase = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const cluster = {
  admin: "postgresql://postgres:postgres@127.0.0.1:55001/nabareview_test",
  runtime:
    "postgresql://naba_test_runtime:naba_test_runtime@127.0.0.1:55001/nabareview_test",
}

describe("run-test-command database guard", () => {
  it("guards the runtime, admin, advisory-lock session and app URLs", () => {
    expect(GUARDED_DATABASE_URL_VARS).toEqual([
      "TEST_RUNTIME_DATABASE_URL",
      "DIRECT_DATABASE_URL",
      "DATABASE_SESSION_URL",
      "DATABASE_URL",
    ])
  })

  it.each([
    "postgresql://u:p@localhost:5432/db",
    "postgresql://u:p@127.0.0.1:55001/db",
    "postgresql://u:p@[::1]:5432/db",
    "postgresql://u:p@0.0.0.0:5432/db",
    "postgresql://u:p@pg.localhost:5432/db",
    "postgresql://u:p@localhost/db",
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
    for (const url of [remote, devDatabase]) {
      expect(() =>
        assertLocalDatabaseUrl("DATABASE_SESSION_URL", {
          DATABASE_SESSION_URL: url,
        })
      ).toThrow(
        expect.objectContaining({
          message: expect.not.stringMatching(/pass|postgres:postgres/),
        })
      )
    }
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

  it.each([
    devDatabase,
    "postgresql://u:p@localhost:54322/naba_visual",
    "postgresql://u:p@[::1]:54322/postgres",
  ])("refuses the local Supabase dev database port in %s", (url) => {
    expect(SUPABASE_DEV_DB_PORT).toBe(54322)
    for (const name of GUARDED_DATABASE_URL_VARS) {
      expect(() => assertLocalTestDatabases({ [name]: url })).toThrow(
        new RegExp(`${name} points at port 54322`)
      )
      // ALLOW_REMOTE_TEST_DB is about other hosts; it does not open 54322.
      expect(() =>
        assertLocalTestDatabases({ [name]: url, ALLOW_REMOTE_TEST_DB: "1" })
      ).toThrow(/port 54322/)
    }
  })

  it("allows port 54322 only with NABA_ALLOW_DEV_DB=1", () => {
    for (const name of GUARDED_DATABASE_URL_VARS) {
      expect(() =>
        assertLocalTestDatabases({
          [name]: devDatabase,
          NABA_ALLOW_DEV_DB: "1",
        })
      ).not.toThrow()
      expect(() =>
        assertLocalTestDatabases({
          [name]: devDatabase,
          NABA_ALLOW_DEV_DB: "true",
        })
      ).toThrow(/port 54322/)
    }
  })
})

describe("run-test-command database choice", () => {
  const provided = {
    DIRECT_DATABASE_URL: cluster.admin,
    TEST_RUNTIME_DATABASE_URL: cluster.runtime,
    DATABASE_URL: cluster.runtime,
    [DISPOSABLE_MARKER]: "127.0.0.1:55001",
  }

  it("starts a throwaway cluster when nothing is provided", () => {
    expect(chooseTestDatabase({})).toEqual({ mode: "start", ignored: [] })
  })

  it("starts a throwaway cluster instead of using unmarked URLs, and names them", () => {
    expect(
      chooseTestDatabase({
        DIRECT_DATABASE_URL: devDatabase,
        DATABASE_URL: devDatabase,
        DATABASE_SESSION_URL: devDatabase,
      })
    ).toEqual({
      mode: "start",
      ignored: ["DIRECT_DATABASE_URL", "DATABASE_SESSION_URL", "DATABASE_URL"],
    })
  })

  it("uses a cluster from postgres.mjs start when every URL reaches it", () => {
    expect(chooseTestDatabase(provided)).toEqual({ mode: "provided" })
    expect(
      chooseTestDatabase({ ...provided, NABA_TEST_DB: "throwaway" })
    ).toEqual({ mode: "provided" })
    // The runtime and session URLs may be left for the harness to derive.
    expect(
      chooseTestDatabase({
        DIRECT_DATABASE_URL: cluster.admin,
        [DISPOSABLE_MARKER]: "127.0.0.1:55001",
      })
    ).toEqual({ mode: "provided" })
  })

  it.each([
    ["a marker for another port", { [DISPOSABLE_MARKER]: "127.0.0.1:55002" }],
    ["a session URL elsewhere", { DATABASE_SESSION_URL: devDatabase }],
    [
      "a runtime URL elsewhere",
      {
        TEST_RUNTIME_DATABASE_URL: devDatabase.replace(
          "postgres:postgres",
          "r:r"
        ),
      },
    ],
    ["no admin URL", { DIRECT_DATABASE_URL: undefined }],
    ["an unparseable URL", { DATABASE_URL: "not a url" }],
    [
      "another host on the port",
      { DIRECT_DATABASE_URL: cluster.admin.replace("127.0.0.1", "localhost") },
    ],
  ])("does not trust the marker with %s", (_, change) => {
    const env = { ...provided, ...change }
    expect(urlsMatchDisposableMarker(env)).toBe(false)
    expect(chooseTestDatabase(env).mode).toBe("start")
  })

  it("matches the default port when a URL leaves it out", () => {
    expect(
      urlsMatchDisposableMarker({
        DIRECT_DATABASE_URL: "postgresql://u:p@127.0.0.1/db",
        [DISPOSABLE_MARKER]: "127.0.0.1:5432",
      })
    ).toBe(true)
  })

  it("uses the configured URLs only with NABA_TEST_DB=existing", () => {
    expect(
      chooseTestDatabase({
        DIRECT_DATABASE_URL: devDatabase,
        NABA_TEST_DB: "existing",
      })
    ).toEqual({ mode: "existing" })
    expect(
      chooseTestDatabase({ ...provided, NABA_TEST_DB: "existing" })
    ).toEqual({
      mode: "existing",
    })
    expect(() => chooseTestDatabase({ NABA_TEST_DB: "shared" })).toThrow(
      /NABA_TEST_DB must be "existing" or "throwaway"/
    )
  })

  it("points every connection variable at the throwaway cluster", () => {
    expect(
      disposableDatabaseEnv({
        adminUrl: cluster.admin,
        runtimeUrl: cluster.runtime,
      })
    ).toEqual({
      DIRECT_DATABASE_URL: cluster.admin,
      TEST_RUNTIME_DATABASE_URL: cluster.runtime,
      DATABASE_URL: cluster.runtime,
      DATABASE_SESSION_URL: cluster.runtime,
    })
    expect(runtimeUrlFor(cluster.admin, {})).toBe(cluster.runtime)
    expect(
      runtimeUrlFor(cluster.admin, {
        RUNTIME_ROLE_NAME: "role",
        RUNTIME_ROLE_PASSWORD: "secret",
      })
    ).toBe("postgresql://role:secret@127.0.0.1:55001/nabareview_test")
  })

  it("reads postgres.mjs start's export lines", () => {
    expect(
      parseExports(
        [
          `export DIRECT_DATABASE_URL='${cluster.admin}'`,
          `export ${DISPOSABLE_MARKER}='127.0.0.1:55001'`,
          "PostgreSQL (native) ready on 127.0.0.1:55001",
          "",
        ].join("\n")
      )
    ).toEqual({
      DIRECT_DATABASE_URL: cluster.admin,
      [DISPOSABLE_MARKER]: "127.0.0.1:55001",
    })
  })
})

describe("run-test-command entry point", () => {
  /** Runs the wrapper with only `env`, plus what finds node. */
  function wrapper(env: Record<string, string>, command: string[]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-test-command.mjs", ...command],
      {
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          ...env,
        },
        timeout: 30_000,
      }
    )
    return { code: result.status, output: `${result.stdout}${result.stderr}` }
  }

  const printEnv = [
    "-e",
    "console.log('RAN ' + JSON.stringify({ url: process.env.DATABASE_URL, session: process.env.DATABASE_SESSION_URL, db: process.env.RUN_DB_TESTS }))",
  ]

  it("refuses the dev database even when told to use the existing URLs", () => {
    const result = wrapper(
      {
        NABA_TEST_DB: "existing",
        DIRECT_DATABASE_URL: devDatabase,
        TEST_RUNTIME_DATABASE_URL: devDatabase,
        DATABASE_SESSION_URL: devDatabase,
      },
      ["integration", process.execPath, ...printEnv]
    )
    expect(result.code).toBe(1)
    expect(result.output).toMatch(/points at port 54322/)
    expect(result.output).not.toContain("RAN ")
  })

  it("runs the command against existing local URLs with NABA_TEST_DB=existing", () => {
    const local = "postgresql://u:p@127.0.0.1:55009/db"
    const result = wrapper(
      {
        NABA_TEST_DB: "existing",
        DIRECT_DATABASE_URL: local,
        TEST_RUNTIME_DATABASE_URL: local,
        DATABASE_SESSION_URL: local,
      },
      ["integration", process.execPath, ...printEnv]
    )
    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain(
      `RAN ${JSON.stringify({ url: local, session: local, db: "true" })}`
    )
  })

  it("refuses a marker whose cluster cannot be shown to be throwaway", async () => {
    // A port nothing listens on: the stamp check cannot pass.
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address() as { port: number }
        probe.close(() => resolve(free))
      })
    })
    const admin = `postgresql://postgres:postgres@127.0.0.1:${port}/nabareview_test`
    const result = wrapper(
      { DIRECT_DATABASE_URL: admin, [DISPOSABLE_MARKER]: `127.0.0.1:${port}` },
      ["e2e", process.execPath, ...printEnv]
    )
    expect(result.code).toBe(1)
    expect(result.output).not.toContain("RAN ")
  })

  it("rejects an unknown mode before touching any database", () => {
    const result = wrapper({}, ["unit", process.execPath, ...printEnv])
    expect(result.code).toBe(1)
    expect(result.output).toContain("Unsupported test mode: unit")
  })
})
