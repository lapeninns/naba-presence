import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto"
import { createServer } from "node:http"

import postgres from "postgres"

const DEFAULT_ADMIN_URL =
  "postgresql://postgres:postgres@127.0.0.1:54329/nabapresence"
const DEFAULT_TOKEN_KEY =
  "local-compose-encryption-key-at-least-32-characters"

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

export function parseLoadArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index]
    if (!entry.startsWith("--")) {
      throw new Error(`Unexpected argument: ${entry}`)
    }
    const [rawName, inlineValue] = entry.slice(2).split("=", 2)
    const name = camelCase(rawName)
    if (inlineValue !== undefined) {
      values[name] = inlineValue
      continue
    }
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith("--")) {
      values[name] = next
      index += 1
    } else {
      values[name] = true
    }
  }
  return {
    ...values,
    baseUrl: String(values.baseUrl ?? "http://127.0.0.1:3200").replace(
      /\/$/,
      ""
    ),
    durationSeconds: boundedNumber(values.duration, 300, 0, 3_600),
    databaseUrl: String(values.databaseUrl ?? DEFAULT_ADMIN_URL),
    tokenEncryptionKey: String(
      values.tokenEncryptionKey ??
        process.env.TOKEN_ENCRYPTION_KEY ??
        DEFAULT_TOKEN_KEY
    ),
    cronSecret: String(values.cronSecret ?? "local-compose-cron-secret"),
    keepFixture: values.keepFixture === true || values.keepFixture === "true",
  }
}

export function boundedNumber(value, fallback, minimum, maximum) {
  if (value === undefined || value === "") return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `Expected a number from ${minimum} to ${maximum}, got: ${value}`
    )
  }
  return parsed
}

function percentile(sorted, percentileValue) {
  if (!sorted.length) return 0
  const index = Math.max(
    0,
    Math.ceil(sorted.length * percentileValue) - 1
  )
  return Math.round(sorted[index] * 100) / 100
}

export function summarizeLoad({
  sent,
  ok,
  failed,
  durationsMs,
}) {
  const sorted = [...durationsMs].sort((left, right) => left - right)
  return {
    sent,
    ok,
    failed,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  }
}

export function printSummary(input) {
  process.stdout.write(`${JSON.stringify(summarizeLoad(input))}\n`)
}

export function diagnostic(event, fields) {
  process.stderr.write(`${JSON.stringify({ event, ...fields })}\n`)
}

export function parsePrometheusHistogramP95(text) {
  const buckets = new Map()
  for (const line of text.split("\n")) {
    if (
      !line.includes("tenant_transaction_duration") ||
      !line.includes("_bucket")
    ) {
      continue
    }
    const match = line.match(/le="([^"]+)".*}\s+([0-9.eE+-]+)$/)
    if (!match) continue
    const boundary =
      match[1] === "+Inf" ? Number.POSITIVE_INFINITY : Number(match[1])
    const value = Number(match[2])
    if (Number.isNaN(boundary) || !Number.isFinite(value)) continue
    buckets.set(boundary, (buckets.get(boundary) ?? 0) + value)
  }
  const ordered = [...buckets.entries()].sort(
    ([left], [right]) => left - right
  )
  if (!ordered.length) return null
  const total = ordered.at(-1)[1]
  const target = total * 0.95
  const boundary = ordered.find(([, count]) => count >= target)?.[0]
  return Number.isFinite(boundary) ? boundary : null
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function timedFetch(url, init = {}) {
  const startedAt = performance.now()
  try {
    const response = await fetch(url, init)
    return {
      response,
      durationMs: performance.now() - startedAt,
      error: null,
    }
  } catch (error) {
    return {
      response: null,
      durationMs: performance.now() - startedAt,
      error,
    }
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export function encryptSecret(value, keyText) {
  const key = createHash("sha256").update(keyText, "utf8").digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
  return Buffer.concat([
    Buffer.from([1]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ])
}

export function openAdmin(databaseUrl) {
  return postgres(databaseUrl, { max: 2, prepare: false })
}

export async function createLoadTenant(
  admin,
  { label = "rel501", sessionCount = 1 } = {}
) {
  const organisationId = randomUUID()
  const userId = randomUUID()
  const tokenValues = Array.from({ length: sessionCount }, () =>
    randomBytes(32).toString("base64url")
  )
  await admin`
    insert into organisation (id, slug, name)
    values (
      ${organisationId},
      ${`${label}-${organisationId.slice(0, 12)}`},
      ${`REL-501 ${label}`}
    )
  `
  await admin`
    insert into app_user (id, email, display_name, default_organisation_id)
    values (
      ${userId},
      ${`${label}-${organisationId.slice(0, 8)}@nabapresence.test`},
      'REL-501 operator',
      ${organisationId}
    )
  `
  await admin`
    insert into member (organisation_id, user_id, role, can_publish)
    values (${organisationId}, ${userId}, 'owner', true)
  `
  for (const token of tokenValues) {
    await admin`
      insert into app_session (
        token_hash,
        user_id,
        organisation_id,
        expires_at
      )
      values (
        ${sha256(token)},
        ${userId},
        ${organisationId},
        now() + interval '2 hours'
      )
    `
  }
  return {
    organisationId,
    userId,
    cookies: tokenValues.map((token) => `naba_session=${token}`),
  }
}

export async function seedConnection(
  admin,
  {
    organisationId,
    tokenEncryptionKey,
    marker = randomUUID(),
  }
) {
  const connectionId = randomUUID()
  const googleAccountName = `accounts/rel501-${marker}`
  await admin`
    insert into google_connection (
      id,
      organisation_id,
      google_subject,
      google_email,
      scope,
      status,
      access_token_ciphertext,
      access_token_expires_at
    )
    values (
      ${connectionId},
      ${organisationId},
      ${`rel501-${marker}`},
      'rel501@example.test',
      'business.manage',
      'active',
      ${encryptSecret("rel501-access-token", tokenEncryptionKey)},
      now() + interval '2 hours'
    )
  `
  return { connectionId, googleAccountName }
}

export async function seedLinkedLocation(
  admin,
  {
    organisationId,
    connectionId,
    googleAccountName,
    marker = randomUUID(),
    index = 1,
  }
) {
  const externalLocationId = randomUUID()
  const locationId = randomUUID()
  const googleLocationName = `locations/rel501-${marker}`
  const title = `REL-501 Location ${index}`
  await admin`
    insert into external_location (
      id,
      organisation_id,
      google_connection_id,
      google_account_name,
      google_location_name,
      title,
      verified
    )
    values (
      ${externalLocationId},
      ${organisationId},
      ${connectionId},
      ${googleAccountName},
      ${googleLocationName},
      ${title},
      true
    )
  `
  await admin`
    insert into location (id, organisation_id, name)
    values (${locationId}, ${organisationId}, ${title})
  `
  await admin`
    insert into location_link (
      organisation_id,
      external_location_id,
      location_id,
      is_active
    )
    values (${organisationId}, ${externalLocationId}, ${locationId}, true)
  `
  await admin`
    insert into webhook_route (
      google_location_name,
      organisation_id,
      external_location_id
    )
    values (
      ${googleLocationName},
      ${organisationId},
      ${externalLocationId}
    )
  `
  return {
    externalLocationId,
    locationId,
    googleLocationName,
    title,
  }
}

export async function destroyLoadTenants(admin, organisationIds) {
  if (!organisationIds.length) return
  await admin.begin(async (sql) => {
    await sql`alter table audit_log disable trigger audit_log_no_update`
    await sql`
      alter table publish_attempt_event
      disable trigger publish_attempt_event_no_update
    `
    await sql`delete from organisation where id in ${sql(organisationIds)}`
    await sql`
      alter table publish_attempt_event
      enable trigger publish_attempt_event_no_update
    `
    await sql`alter table audit_log enable trigger audit_log_no_update`
  })
  await admin`
    delete from app_user
    where email like 'rel501-%@nabapresence.test'
      and default_organisation_id is null
  `
}

export async function startLoadStub({ port, handler }) {
  const server = createServer(async (request, response) => {
    let raw = ""
    for await (const chunk of request) raw += chunk
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`)
    try {
      const result = await handler({
        method: request.method ?? "GET",
        url,
        body: raw ? JSON.parse(raw) : undefined,
      })
      response.writeHead(result.status, {
        "content-type": "application/json",
      })
      response.end(JSON.stringify(result.json ?? {}))
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        })
      )
    }
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "0.0.0.0", resolve)
  })
  return {
    stop: () =>
      new Promise((resolve) => server.close(() => resolve(undefined))),
  }
}
