import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { once } from "node:events"

type StubFactor = {
  id: string
  friendlyName: string
  status: "verified" | "unverified"
  /** The one code this stub accepts for the factor. */
  code: string
}

type StubUser = {
  id: string
  email: string
  password: string
  displayName: string
  confirmed: boolean
  factors: StubFactor[]
}

/** The code a factor accepts unless addFactor names another. */
export const STUB_TOTP_CODE = "246810"

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<
    string,
    unknown
  >
}

function providerUser(user: StubUser) {
  return {
    id: user.id,
    email: user.email,
    email_confirmed_at: user.confirmed
      ? "2026-07-30T10:00:00.000Z"
      : null,
    user_metadata: { display_name: user.displayName },
    factors: user.factors.map((factor) => ({
      id: factor.id,
      factor_type: "totp",
      status: factor.status,
      friendly_name: factor.friendlyName,
    })),
  }
}

function json(
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>
) {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(value))
}

// Test-only escape hatches: a request whose email is one of these two
// sentinels gets that specific GoTrue-shaped error instead of the normal
// success response, so tests can force the branches real account traffic
// would rarely hit (rate limiting, an opaque provider failure) without
// needing a real provider.
export const RATE_LIMITED_EMAIL = "rate-limited@nabapresence.test"
export const PROVIDER_ERROR_EMAIL = "provider-error@nabapresence.test"

function simulatedFailure(
  email: string
): { status: number; error_code: string } | null {
  if (email === RATE_LIMITED_EMAIL) {
    return { status: 429, error_code: "over_email_send_rate_limit" }
  }
  if (email === PROVIDER_ERROR_EMAIL) {
    return { status: 500, error_code: "unexpected_failure" }
  }
  return null
}

export async function startAuthProviderStub() {
  const users = new Map<string, StubUser>()
  const confirmationTokens = new Map<string, string>()
  const recoveryTokens = new Map<string, string>()
  const resetRequests: Array<{ email: string; redirectTo: string | null }> = []
  const resendRequests: Array<{ email: string; redirectTo: string | null }> =
    []
  const passwordUpdates: Array<{ email: string; password: string }> = []
  const accessTokens = new Map<string, { email: string; aal: string }>()
  const challenges = new Map<string, string>()
  const mfaCalls: Array<{ kind: "enroll" | "challenge" | "verify"; factorId?: string }> = []

  // GoTrue-shaped access tokens: a JWT whose claims carry aal and amr. The
  // signature is not checked by the app (lib/server/mfa.ts).
  function issueToken(user: StubUser, aal: "aal1" | "aal2") {
    const token = [
      base64url({ alg: "HS256", typ: "JWT" }),
      base64url({
        sub: user.id,
        aal,
        amr:
          aal === "aal2"
            ? [{ method: "totp" }, { method: "password" }]
            : [{ method: "password" }],
        nonce: crypto.randomUUID(),
      }),
      "stub-signature",
    ].join(".")
    accessTokens.set(token, { email: user.email, aal })
    return token
  }

  function bearerUser(request: IncomingMessage) {
    const bearer = request.headers.authorization?.replace(/^Bearer /, "")
    const entry = bearer ? accessTokens.get(bearer) : undefined
    const user = entry ? users.get(entry.email) : undefined
    return user && entry ? { user, aal: entry.aal } : null
  }

  function addUser(input: {
    id: string
    email: string
    password: string
    displayName?: string
    confirmed?: boolean
  }) {
    const user: StubUser = {
      ...input,
      email: input.email.toLowerCase(),
      displayName: input.displayName ?? "Auth route user",
      confirmed: input.confirmed ?? true,
      factors: [],
    }
    users.set(user.email, user)
    return user
  }

  /** Gives a user an already-verified TOTP factor. */
  function addFactor(
    email: string,
    input: { code?: string; friendlyName?: string } = {}
  ) {
    const user = users.get(email.toLowerCase())
    if (!user) throw new Error(`No stub user ${email}`)
    const factor: StubFactor = {
      id: crypto.randomUUID(),
      friendlyName: input.friendlyName ?? `Factor ${user.factors.length + 1}`,
      status: "verified",
      code: input.code ?? STUB_TOTP_CODE,
    }
    user.factors.push(factor)
    return factor
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      const body = await requestBody(request)

      if (
        request.method === "POST" &&
        url.pathname === "/auth/v1/token" &&
        url.searchParams.get("grant_type") === "password"
      ) {
        const email = String(body.email ?? "").toLowerCase()
        const user = users.get(email)
        if (!user || user.password !== body.password) {
          return json(response, 400, {
            error_code: "invalid_credentials",
          })
        }
        if (!user.confirmed) {
          return json(response, 400, {
            error_code: "email_not_confirmed",
          })
        }
        return json(response, 200, {
          access_token: issueToken(user, "aal1"),
          refresh_token: `refresh-${user.id}`,
          user: providerUser(user),
        })
      }

      if (request.method === "POST" && url.pathname === "/auth/v1/signup") {
        const email = String(body.email ?? "").toLowerCase()
        if (users.has(email)) {
          return json(response, 422, { error_code: "user_already_exists" })
        }
        const metadata =
          body.data && typeof body.data === "object"
            ? (body.data as Record<string, unknown>)
            : {}
        const user = addUser({
          id: crypto.randomUUID(),
          email,
          password: String(body.password ?? ""),
          displayName: String(metadata.display_name ?? "New user"),
          confirmed: false,
        })
        const tokenHash = `confirmation-token-${user.id}`
        confirmationTokens.set(tokenHash, email)
        return json(response, 200, providerUser(user))
      }

      if (request.method === "POST" && url.pathname === "/auth/v1/recover") {
        const email = String(body.email ?? "").toLowerCase()
        const failure = simulatedFailure(email)
        if (failure) {
          return json(response, failure.status, {
            error_code: failure.error_code,
          })
        }
        resetRequests.push({
          email,
          redirectTo: url.searchParams.get("redirect_to"),
        })
        const user = users.get(email)
        if (user) {
          recoveryTokens.set(`recovery-token-${user.id}`, email)
        }
        return json(response, 200, {})
      }

      if (request.method === "POST" && url.pathname === "/auth/v1/resend") {
        const email = String(body.email ?? "").toLowerCase()
        const failure = simulatedFailure(email)
        if (failure) {
          return json(response, failure.status, {
            error_code: failure.error_code,
          })
        }
        resendRequests.push({
          email,
          redirectTo: url.searchParams.get("redirect_to"),
        })
        return json(response, 200, {})
      }

      if (request.method === "POST" && url.pathname === "/auth/v1/verify") {
        const tokenHash = String(body.token_hash ?? "")
        const type = String(body.type ?? "")
        const email =
          type === "email"
            ? confirmationTokens.get(tokenHash)
            : type === "recovery"
              ? recoveryTokens.get(tokenHash)
              : undefined
        const user = email ? users.get(email) : undefined
        if (!user) {
          return json(response, 403, {
            error_code: "otp_expired",
          })
        }
        user.confirmed = true
        return json(response, 200, {
          access_token: issueToken(user, "aal1"),
          refresh_token: `refresh-${user.id}`,
          user: providerUser(user),
        })
      }

      if (request.method === "GET" && url.pathname === "/auth/v1/user") {
        const caller = bearerUser(request)
        if (!caller) return json(response, 401, { error_code: "bad_jwt" })
        return json(response, 200, providerUser(caller.user))
      }

      if (request.method === "POST" && url.pathname === "/auth/v1/factors") {
        const caller = bearerUser(request)
        if (!caller) return json(response, 401, { error_code: "bad_jwt" })
        const verified = caller.user.factors.filter(
          (factor) => factor.status === "verified"
        )
        // GoTrue: a user with a verified factor enrolls another only at aal2.
        if (verified.length > 0 && caller.aal !== "aal2") {
          return json(response, 403, { error_code: "insufficient_aal" })
        }
        const friendlyName = String(body.friendly_name ?? "")
        if (
          caller.user.factors.some(
            (factor) => factor.friendlyName === friendlyName
          )
        ) {
          return json(response, 422, { error_code: "mfa_factor_name_conflict" })
        }
        const factor: StubFactor = {
          id: crypto.randomUUID(),
          friendlyName,
          status: "unverified",
          code: STUB_TOTP_CODE,
        }
        caller.user.factors.push(factor)
        mfaCalls.push({ kind: "enroll", factorId: factor.id })
        return json(response, 200, {
          id: factor.id,
          type: "totp",
          friendly_name: friendlyName,
          totp: {
            qr_code: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
            secret: "STUBSECRETBASE32",
            uri: `otpauth://totp/NabaPresence:${caller.user.email}?secret=STUBSECRETBASE32`,
          },
        })
      }

      const factorRoute = url.pathname.match(
        /^\/auth\/v1\/factors\/([^/]+)\/(challenge|verify)$/
      )
      if (request.method === "POST" && factorRoute) {
        const caller = bearerUser(request)
        if (!caller) return json(response, 401, { error_code: "bad_jwt" })
        const [, factorId, action] = factorRoute
        const factor = caller.user.factors.find((item) => item.id === factorId)
        if (!factor) return json(response, 404, { error_code: "mfa_factor_not_found" })
        if (action === "challenge") {
          const challengeId = crypto.randomUUID()
          challenges.set(challengeId, factor.id)
          mfaCalls.push({ kind: "challenge", factorId: factor.id })
          return json(response, 200, {
            id: challengeId,
            type: "totp",
            expires_at: Math.floor(Date.now() / 1000) + 300,
          })
        }
        mfaCalls.push({ kind: "verify", factorId: factor.id })
        const challengeId = String(body.challenge_id ?? "")
        if (challenges.get(challengeId) !== factor.id) {
          return json(response, 422, { error_code: "mfa_challenge_expired" })
        }
        challenges.delete(challengeId)
        if (String(body.code ?? "") !== factor.code) {
          return json(response, 422, { error_code: "mfa_verification_failed" })
        }
        factor.status = "verified"
        return json(response, 200, {
          access_token: issueToken(caller.user, "aal2"),
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: `refresh-${caller.user.id}`,
          user: providerUser(caller.user),
        })
      }

      if (request.method === "PUT" && url.pathname === "/auth/v1/user") {
        const caller = bearerUser(request)
        const user = caller?.user
        if (!user || typeof body.password !== "string") {
          return json(response, 401, {
            error_code: "invalid_token",
          })
        }
        user.password = body.password
        passwordUpdates.push({ email: user.email, password: body.password })
        return json(response, 200, { user: providerUser(user) })
      }

      return json(response, 404, { error_code: "not_found" })
    } catch {
      return json(response, 500, { error_code: "stub_failed" })
    }
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Auth provider stub did not bind a TCP port")
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    users,
    resetRequests,
    resendRequests,
    passwordUpdates,
    mfaCalls,
    addUser,
    addFactor,
    confirmationToken(email: string) {
      const entry = [...confirmationTokens].find(
        ([, tokenEmail]) => tokenEmail === email.toLowerCase()
      )
      return entry?.[0]
    },
    recoveryToken(email: string) {
      const entry = [...recoveryTokens].find(
        ([, tokenEmail]) => tokenEmail === email.toLowerCase()
      )
      return entry?.[0]
    },
    stop: async () => {
      server.close()
      await once(server, "close")
    },
  }
}
