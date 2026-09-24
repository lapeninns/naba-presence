import { createCipheriv, createHash, randomBytes } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

const env = {
  TOKEN_ENCRYPTION_KEY: "original-token-key-with-32-characters!!",
  TOKEN_ENCRYPTION_KEYS: [] as string[],
  NEXTAUTH_SECRET: "nextauth-secret-with-at-least-32-characters",
  OAUTH_STATE_SECRET: undefined as string | undefined,
  OAUTH_STATE_ACCEPT_LEGACY: true,
}

vi.mock("@/lib/server/env", () => ({ getServerEnv: () => env }))

const {
  decryptSecret,
  encryptSecret,
  isOnActiveKey,
  reencryptSecret,
  signOAuthState,
  verifyOAuthState,
} = await import("@/lib/server/crypto")

const ORIGINAL = "original-token-key-with-32-characters!!"
const NEXT = "next-rotation-token-key-32-characters!!!"
const RETIRED = "retired-token-key-with-32-characters!!!!"

/** Format 0x01 exactly as the pre-rotation code (and the test harness) wrote it. */
function legacyCiphertext(secret: string, value: string) {
  const key = createHash("sha256").update(secret, "utf8").digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), body])
}

beforeEach(() => {
  env.TOKEN_ENCRYPTION_KEY = ORIGINAL
  env.TOKEN_ENCRYPTION_KEYS = []
  env.OAUTH_STATE_SECRET = undefined
  env.OAUTH_STATE_ACCEPT_LEGACY = true
})

describe("token encryption key rotation", () => {
  it("keeps writing the original format until a key list is configured", () => {
    const sealed = encryptSecret("refresh-token")
    expect(sealed[0]).toBe(1)
    expect(decryptSecret(sealed)).toBe("refresh-token")
    expect(isOnActiveKey(sealed)).toBe(true)
  })

  it("reads tokens written before rotation existed", () => {
    expect(decryptSecret(legacyCiphertext(ORIGINAL, "stored-before"))).toBe(
      "stored-before"
    )
  })

  it("reads old and new ciphertext side by side during a rotation", () => {
    const before = legacyCiphertext(ORIGINAL, "old-refresh-token")
    env.TOKEN_ENCRYPTION_KEYS = [NEXT, ORIGINAL]
    const after = encryptSecret("new-refresh-token")

    expect(after[0]).toBe(2)
    expect(decryptSecret(before)).toBe("old-refresh-token")
    expect(decryptSecret(after)).toBe("new-refresh-token")
    expect(isOnActiveKey(before)).toBe(false)
    expect(isOnActiveKey(after)).toBe(true)
  })

  it("re-encrypts onto the active key without changing the secret", () => {
    const before = legacyCiphertext(ORIGINAL, "keep-me")
    env.TOKEN_ENCRYPTION_KEYS = [NEXT, ORIGINAL]
    const moved = reencryptSecret(before)

    expect(isOnActiveKey(moved)).toBe(true)
    expect(decryptSecret(moved)).toBe("keep-me")
    // Once every row is moved the old key can go; the moved row still opens.
    env.TOKEN_ENCRYPTION_KEYS = [NEXT]
    env.TOKEN_ENCRYPTION_KEY = NEXT
    expect(decryptSecret(moved)).toBe("keep-me")
  })

  it("refuses ciphertext from a key that has been retired", () => {
    env.TOKEN_ENCRYPTION_KEYS = [RETIRED]
    const sealed = encryptSecret("plaintext-value-xyz")
    env.TOKEN_ENCRYPTION_KEYS = [NEXT]
    expect(() => decryptSecret(sealed)).toThrow(/not configured/)
    // The error names neither the key nor the value.
    try {
      decryptSecret(sealed)
    } catch (error) {
      expect(String(error)).not.toContain("plaintext-value-xyz")
      expect(String(error)).not.toContain(RETIRED)
    }
  })

  it("never decrypts with a wrong key", () => {
    expect(() => decryptSecret(legacyCiphertext(RETIRED, "x"))).toThrow()
  })
})

describe("OAuth state signing", () => {
  it("signs with NEXTAUTH_SECRET until a dedicated secret exists", () => {
    const signature = signOAuthState("payload")
    expect(verifyOAuthState("payload", signature)).toBe(true)
    expect(verifyOAuthState("tampered", signature)).toBe(false)
  })

  it("carries in-flight consents across the switch to OAUTH_STATE_SECRET", () => {
    const beforeSwitch = signOAuthState("payload")
    env.OAUTH_STATE_SECRET = "dedicated-oauth-state-secret-32-chars!!"
    const afterSwitch = signOAuthState("payload")

    expect(afterSwitch).not.toBe(beforeSwitch)
    expect(verifyOAuthState("payload", afterSwitch)).toBe(true)
    expect(verifyOAuthState("payload", beforeSwitch)).toBe(true)

    // Once the transition window is closed, only the dedicated secret signs.
    env.OAUTH_STATE_ACCEPT_LEGACY = false
    expect(verifyOAuthState("payload", beforeSwitch)).toBe(false)
    expect(verifyOAuthState("payload", afterSwitch)).toBe(true)
  })
})
