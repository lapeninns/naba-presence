import "server-only"

/**
 * Which connection issued an access token, for the transport's benefit.
 *
 * `googleRequest` only sees a bearer token, and some thirty call sites pass
 * one. When Google answers 401 (or 403 for missing scopes) the connection
 * has to be marked for reconnect through `persistConnectionFailure`, which
 * needs the organisation and connection ids. Recording them here when
 * `connectionAccessToken` hands a token out lets the transport find them
 * without threading ids through every caller.
 *
 * Process-local and bounded. A token this process did not hand out (the
 * OAuth callback's first userinfo call, a test) is simply unknown, and its
 * failure surfaces unchanged.
 */
export type AccessTokenOwner = {
  readonly organisationId: string
  readonly connectionId: string
  /**
   * The credential generation the token was issued under. A 401 on a token
   * from before a reconnect must not flag the credential that replaced it.
   */
  readonly generation: number
}

// Access tokens live an hour; nothing here needs to outlive one.
const TOKEN_TTL_MS = 60 * 60 * 1000
const MAX_TOKENS = 2_000

const owners = new Map<string, AccessTokenOwner & { readonly expiresAt: number }>()

export function rememberAccessToken(token: string, owner: AccessTokenOwner) {
  owners.delete(token)
  owners.set(token, { ...owner, expiresAt: Date.now() + TOKEN_TTL_MS })
  if (owners.size <= MAX_TOKENS) return
  const now = Date.now()
  for (const [key, value] of owners) {
    if (value.expiresAt <= now || owners.size > MAX_TOKENS) owners.delete(key)
    else break
  }
}

export function accessTokenOwner(token: string): AccessTokenOwner | null {
  const owner = owners.get(token)
  if (!owner) return null
  if (owner.expiresAt <= Date.now()) {
    owners.delete(token)
    return null
  }
  return {
    organisationId: owner.organisationId,
    connectionId: owner.connectionId,
    generation: owner.generation,
  }
}

export function forgetAccessToken(token: string) {
  owners.delete(token)
}
