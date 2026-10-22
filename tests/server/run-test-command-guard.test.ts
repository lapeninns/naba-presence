import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { constants, tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  GUARDED_DATABASE_URL_VARS,
  SIGNAL_EXIT_CODES,
  assertLocalDatabaseUrl,
  assertLocalTestDatabases,
  chooseTestDatabase,
  parseExports,
  throwawayClusterEnv,
} from "../../scripts/run-test-command.mjs"
import {
  DISPOSABLE_MARKER,
  SUPABASE_DEV_DB_PORT,
  disposableDatabaseEnv,
  runtimeUrlFor,
  urlsMatchDisposableMarker,
} from "../../scripts/test-database.mjs"
import { serverEnv } from "../integration/helpers/app-server"

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

  it("takes a URL's missing port from PGPORT, as postgres.js does", () => {
    const portless = "postgresql://u:p@localhost/postgres"
    expect(() =>
      assertLocalDatabaseUrl("DIRECT_DATABASE_URL", {
        DIRECT_DATABASE_URL: portless,
        PGPORT: "54322",
      })
    ).toThrow(/54322/)
    for (const name of GUARDED_DATABASE_URL_VARS) {
      expect(() =>
        assertLocalTestDatabases({ [name]: portless, PGPORT: "54322" })
      ).toThrow(new RegExp(`${name} points at port 54322`))
    }
    // A port in the URL wins over PGPORT, as it does for the client.
    expect(() =>
      assertLocalDatabaseUrl("DIRECT_DATABASE_URL", {
        DIRECT_DATABASE_URL: "postgresql://u:p@localhost:5432/postgres",
        PGPORT: "54322",
      })
    ).not.toThrow()
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

  it("matches a URL that leaves the port out on the port PGPORT names", () => {
    const portless = { DIRECT_DATABASE_URL: "postgresql://u:p@127.0.0.1/db" }
    expect(
      urlsMatchDisposableMarker({
        ...portless,
        PGPORT: "55001",
        [DISPOSABLE_MARKER]: "127.0.0.1:55001",
      })
    ).toBe(true)
    // The client would connect to 54322, not the marker's 5432.
    expect(
      urlsMatchDisposableMarker({
        ...portless,
        PGPORT: "54322",
        [DISPOSABLE_MARKER]: "127.0.0.1:5432",
      })
    ).toBe(false)
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

describe("run-test-command cluster lifecycle", () => {
  it("gives each run its own SHARD, which names the docker container", () => {
    const caller = {
      PATH: "/usr/bin",
      SHARD: "2",
      GITHUB_ENV: "/runner/env",
      RUNTIME_ROLE_NAME: "role",
      RUNTIME_ROLE_PASSWORD: "secret",
    }
    const firstDir = join(tmpdir(), "naba-pg-run-aB3xYz")
    const secondDir = join(tmpdir(), "naba-pg-run-Qr7kLm")
    const first = throwawayClusterEnv(caller, firstDir)
    const second = throwawayClusterEnv(caller, secondDir)

    // postgres.mjs names the container naba-pg-<run id>-<job>-<SHARD>: a
    // SHARD the caller exported, or none, would be shared by concurrent runs.
    expect(first).toEqual({
      PATH: "/usr/bin",
      NABA_PG_DIR: firstDir,
      SHARD: "naba-pg-run-aB3xYz",
    })
    expect(second).toEqual({
      PATH: "/usr/bin",
      NABA_PG_DIR: secondDir,
      SHARD: "naba-pg-run-Qr7kLm",
    })
    expect(throwawayClusterEnv({}, firstDir).SHARD).toBe("naba-pg-run-aB3xYz")
    expect(caller.SHARD).toBe("2")
  })

  it("exits 128 + the signal's number for each signal that ends a run", () => {
    expect(SIGNAL_EXIT_CODES).toEqual({
      SIGHUP: 129,
      SIGINT: 130,
      SIGTERM: 143,
    })
    for (const [signal, code] of Object.entries(SIGNAL_EXIT_CODES)) {
      expect(code).toBe(
        128 + constants.signals[signal as keyof typeof constants.signals]
      )
    }
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

  it("passes a hangup on to the command and exits 129", async () => {
    const local = "postgresql://u:p@127.0.0.1:55009/db"
    // Reports its pid, then waits for SIGHUP; gives up on its own so a
    // wrapper that dies without passing the signal on leaves nothing behind.
    const command = [
      "process.on('SIGHUP', () => process.stdout.write('COMMAND GOT SIGHUP\\n', () => process.exit(0)))",
      "setTimeout(() => process.exit(3), 4000)",
      "console.log('READY ' + process.pid)",
    ].join(";")
    const run = spawn(
      process.execPath,
      [
        "scripts/run-test-command.mjs",
        "integration",
        process.execPath,
        "-e",
        command,
      ],
      {
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          NABA_TEST_DB: "existing",
          DIRECT_DATABASE_URL: local,
          TEST_RUNTIME_DATABASE_URL: local,
          DATABASE_SESSION_URL: local,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    let output = ""
    let commandPid: number | undefined
    const ready = new Promise<"ready">((resolve) => {
      run.stdout.on("data", (chunk) => {
        output += chunk
        const match = /READY (\d+)/.exec(output)
        if (match) {
          commandPid = Number(match[1])
          resolve("ready")
        }
      })
    })
    run.stderr.on("data", (chunk) => (output += chunk))
    const exited = once(run, "exit")
    const closed = once(run, "close")
    try {
      expect(
        await Promise.race([ready, exited.then(() => "exited")]),
        output
      ).toBe("ready")
      // Only the wrapper is signalled, as `kill -HUP <pid>` would.
      run.kill("SIGHUP")
      const [code, signal] = await exited
      expect({ code, signal }, output).toEqual({ code: 129, signal: null })
      await closed
      expect(output).toContain("COMMAND GOT SIGHUP")
    } finally {
      if (run.exitCode === null && run.signalCode === null) run.kill("SIGKILL")
      if (commandPid) {
        try {
          process.kill(commandPid, "SIGKILL")
        } catch {
          // already gone
        }
      }
    }
  })
})

describe("integration app server environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("sets the session URL, so a .env in the standalone build cannot", () => {
    const session =
      "postgresql://naba_test_runtime:naba_test_runtime@127.0.0.1:55001/sessions"
    vi.stubEnv("TEST_RUNTIME_DATABASE_URL", cluster.runtime)
    vi.stubEnv("DATABASE_SESSION_URL", undefined)
    expect(serverEnv(3100, {})).toMatchObject({
      DATABASE_URL: cluster.runtime,
      DATABASE_SESSION_URL: cluster.runtime,
    })

    vi.stubEnv("DATABASE_SESSION_URL", session)
    expect(serverEnv(3100, {}).DATABASE_SESSION_URL).toBe(session)
    // A suite's own override still wins.
    expect(
      serverEnv(3100, { DATABASE_SESSION_URL: cluster.admin })
        .DATABASE_SESSION_URL
    ).toBe(cluster.admin)
  })
})
