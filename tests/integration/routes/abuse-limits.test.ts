import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startAuthProviderStub } from "../helpers/auth-provider"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// The values ABUSE_POLICIES.login sets (lib/server/abuse-limits.ts).
const LOGIN_EMAIL_LIMIT = 90
const LOGIN_IP_LIMIT = 30
const LOGIN_WINDOW_SECONDS = 15 * 60

/**
 * Windows are aligned to multiples of their length, so a run that straddles
 * a boundary would see its counts reset half way. Start well inside one.
 */
async function awayFromWindowEdge(windowSeconds: number, marginSeconds = 60) {
  const intoWindow = (Date.now() / 1000) % windowSeconds
  const left = windowSeconds - intoWindow
  if (left < marginSeconds) {
    await new Promise((resolve) => setTimeout(resolve, (left + 1) * 1000))
  }
}

/** A random documentation-range address, unique per call in practice. */
function testIp() {
  const octet = () => Math.floor(Math.random() * 254) + 1
  return `198.18.${octet()}.${octet()}`
}

describeDatabase("PostgreSQL-backed abuse limits", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  let auth: Awaited<ReturnType<typeof startAuthProviderStub>>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const scopes = ["login_ip", "login_email", "it_concurrency", "it_purge"]

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 20 })
    auth = await startAuthProviderStub()
    server = await startAppServer({
      PASSWORD_AUTH_ENABLED: "true",
      SUPABASE_URL: auth.baseUrl,
      SUPABASE_PUBLISHABLE_KEY: "stub-publishable-key",
      ABUSE_LIMITS_ENABLED: "true",
      // Stands in for Vercel, which overwrites this header on every request.
      CLIENT_IP_HEADER: "x-vercel-forwarded-for",
    })
  })

  afterAll(async () => {
    await server.stop()
    await auth.stop()
    await admin`delete from abuse_rate_bucket where scope in ${admin(scopes)}`
    await runtime.end()
    await admin.end()
  })

  function login(email: string, ip: string) {
    return fetch(`${server.baseUrl}/api/auth/password/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vercel-forwarded-for": ip,
      },
      body: JSON.stringify({ email, password: "Wrong password!1" }),
    })
  }

  it("refuses the attempt after the email's limit, from any address, with Retry-After", async () => {
    await awayFromWindowEdge(LOGIN_WINDOW_SECONDS)
    const email = `abuse-${randomUUID()}@nabapresence.test`
    for (let attempt = 0; attempt < LOGIN_EMAIL_LIMIT; attempt += 1) {
      const response = await login(email, testIp())
      expect(response.status).toBe(401)
    }
    const limited = await login(email, testIp())
    expect(limited.status).toBe(429)
    const retryAfter = Number(limited.headers.get("retry-after"))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(LOGIN_WINDOW_SECONDS)
    expect(await limited.json()).toMatchObject({
      error: "auth_rate_limited",
      details: { retryAfter },
    })
    // The email itself is never stored.
    const [stored] = await admin<{ count: number }[]>`
        select count(*)::int as count from abuse_rate_bucket
        where key_hash ilike ${`%${email.split("@")[0]}%`}
      `
    expect(stored.count).toBe(0)
  }, 120_000)

  it("does not let one address lock an account out", async () => {
    await awayFromWindowEdge(LOGIN_WINDOW_SECONDS)
    const email = `abuse-${randomUUID()}@nabapresence.test`
    const attacker = testIp()
    for (let attempt = 0; attempt < LOGIN_IP_LIMIT; attempt += 1) {
      expect((await login(email, attacker)).status).toBe(401)
    }
    expect((await login(email, attacker)).status).toBe(429)
    // The owner, elsewhere, is still judged on the password alone.
    expect((await login(email, testIp())).status).toBe(401)
  }, 120_000)

  it("keeps separate buckets for separate addresses", async () => {
    await awayFromWindowEdge(LOGIN_WINDOW_SECONDS)
    const busy = testIp()
    for (let attempt = 0; attempt < LOGIN_IP_LIMIT; attempt += 1) {
      const response = await login(
        `abuse-${randomUUID()}@nabapresence.test`,
        busy
      )
      expect(response.status).toBe(401)
    }
    const limited = await login(`abuse-${randomUUID()}@nabapresence.test`, busy)
    expect(limited.status).toBe(429)
    // A spoofed x-forwarded-for does not move the request to a new bucket.
    const spoofed = await fetch(`${server.baseUrl}/api/auth/password/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-vercel-forwarded-for": busy,
        "x-forwarded-for": testIp(),
      },
      body: JSON.stringify({
        email: `abuse-${randomUUID()}@nabapresence.test`,
        password: "Wrong password!1",
      }),
    })
    expect(spoofed.status).toBe(429)
    const other = await login(
      `abuse-${randomUUID()}@nabapresence.test`,
      testIp()
    )
    expect(other.status).toBe(401)
  }, 120_000)

  it("counts concurrent hits exactly and allows no more than the limit", async () => {
    await awayFromWindowEdge(3600)
    const key = randomUUID().replaceAll("-", "")
    const results = await Promise.all(
      Array.from(
        { length: 50 },
        () => runtime<{ allowed: boolean }[]>`
          select allowed from take_abuse_budget('it_concurrency', ${key}, 20, 3600)
        `
      )
    )
    expect(results.filter(([row]) => row.allowed)).toHaveLength(20)
    const [bucket] = await admin<{ hits: number }[]>`
      select hits from abuse_rate_bucket
      where scope = 'it_concurrency' and key_hash = ${key}
    `
    expect(bucket.hits).toBe(50)
  }, 120_000)

  it("keeps the table behind its functions for the runtime role", async () => {
    // Select is granted but RLS has no policy, so no row is ever visible;
    // nothing else is granted at all.
    await admin`
      insert into abuse_rate_bucket (scope, key_hash, window_start, expires_at, hits)
      values ('it_purge', ${randomUUID().replaceAll("-", "")}, now(), now() + interval '1 hour', 1)
    `
    expect(await runtime`select * from abuse_rate_bucket`).toHaveLength(0)
    await expect(runtime`delete from abuse_rate_bucket`).rejects.toMatchObject({
      code: "42501",
    })
    await expect(
      runtime`update abuse_rate_bucket set hits = 0`
    ).rejects.toMatchObject({ code: "42501" })
    await admin`delete from abuse_rate_bucket where scope = 'it_purge'`
  })

  it("purges ended windows from the retention cron and keeps live ones", async () => {
    const ended = randomUUID().replaceAll("-", "")
    const live = randomUUID().replaceAll("-", "")
    await admin`
      insert into abuse_rate_bucket (scope, key_hash, window_start, expires_at, hits)
      values
        ('it_purge', ${ended}, now() - interval '2 hours', now() - interval '1 hour', 3),
        ('it_purge', ${live}, now(), now() + interval '1 hour', 3)
    `
    const response = await fetch(
      `${server.baseUrl}/api/cron/retention?batch_size=1`,
      {
        method: "POST",
        headers: { authorization: "Bearer route-harness-cron-secret" },
      }
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { abuseRateBuckets: number | null }
    expect(body.abuseRateBuckets).toBeGreaterThanOrEqual(1)
    const remaining = await admin<{ keyHash: string }[]>`
      select key_hash as "keyHash" from abuse_rate_bucket where scope = 'it_purge'
    `
    expect(remaining.map((row) => row.keyHash)).toEqual([live])
  })
})
