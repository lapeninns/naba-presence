import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

import { getServerEnv } from "@/lib/server/env"

/**
 * Secrets at rest (OAuth tokens, invitation tokens) are AES-256-GCM.
 *
 * Two formats, told apart by the first byte:
 *
 *   0x01  iv(12) tag(16) ciphertext        the original format. No key id,
 *                                          so it is decrypted by trying each
 *                                          configured key; GCM's tag rejects
 *                                          every wrong one.
 *   0x02  keyId(4) iv(12) tag(16) ciph.    names the key that wrote it, so a
 *                                          rotation can find what still needs
 *                                          re-encrypting.
 *
 * Keys come from TOKEN_ENCRYPTION_KEYS (comma-separated, the first is
 * active, the rest are accepted for decryption) plus TOKEN_ENCRYPTION_KEY,
 * which stays accepted so nothing written before the list existed becomes
 * unreadable. Each secret is stretched with SHA-256, as before.
 *
 * New writes use format 0x02 only once TOKEN_ENCRYPTION_KEYS is set. Until
 * then they stay 0x01, so rolling this code back never meets a format the
 * old code cannot read. docs/runbook.md, "Rotating the token encryption
 * key", has the procedure.
 */

const LEGACY_FORMAT = 1
const KEYED_FORMAT = 2
const KEY_ID_BYTES = 4

type EncryptionKey = { id: Buffer; key: Buffer }

function deriveKey(secret: string): EncryptionKey {
  const key = createHash("sha256").update(secret, "utf8").digest()
  // Derived from the key, not the secret, and truncated: identifies a key
  // without offering anything to attack it with.
  const id = createHash("sha256")
    .update("naba-token-key-id:")
    .update(key)
    .digest()
    .subarray(0, KEY_ID_BYTES)
  return { id, key }
}

type KeyRing = {
  active: EncryptionKey
  /** Every accepted key, active first. */
  all: EncryptionKey[]
  keyedWrites: boolean
}

let cachedRing: { source: string; ring: KeyRing } | undefined

function keyRing(): KeyRing {
  const env = getServerEnv()
  const listed = env.TOKEN_ENCRYPTION_KEYS
  const source = `${listed.join(",")}|${env.TOKEN_ENCRYPTION_KEY}`
  if (cachedRing?.source === source) return cachedRing.ring
  const secrets = [...listed]
  if (!secrets.includes(env.TOKEN_ENCRYPTION_KEY)) {
    secrets.push(env.TOKEN_ENCRYPTION_KEY)
  }
  const all = secrets.map(deriveKey)
  const ring = { active: all[0], all, keyedWrites: listed.length > 0 }
  cachedRing = { source, ring }
  return ring
}

export function encryptSecret(value: string): Buffer {
  const { active, keyedWrites } = keyRing()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", active.key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return keyedWrites
    ? Buffer.concat([
        Buffer.from([KEYED_FORMAT]),
        active.id,
        iv,
        tag,
        ciphertext,
      ])
    : Buffer.concat([Buffer.from([LEGACY_FORMAT]), iv, tag, ciphertext])
}

function open(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8")
}

export function decryptSecret(value: Buffer): string {
  const ring = keyRing()
  if (value[0] === KEYED_FORMAT && value.length >= 1 + KEY_ID_BYTES + 28) {
    const id = value.subarray(1, 1 + KEY_ID_BYTES)
    const key = ring.all.find((candidate) => candidate.id.equals(id))
    if (!key) {
      // Never the value, never the key: only that a retired key is missing.
      throw new Error("Encrypted secret uses a key that is not configured")
    }
    const offset = 1 + KEY_ID_BYTES
    return open(
      key.key,
      value.subarray(offset, offset + 12),
      value.subarray(offset + 12, offset + 28),
      value.subarray(offset + 28)
    )
  }
  if (value[0] !== LEGACY_FORMAT || value.length < 30) {
    throw new Error("Unsupported encrypted secret format")
  }
  const iv = value.subarray(1, 13)
  const tag = value.subarray(13, 29)
  const ciphertext = value.subarray(29)
  for (const candidate of ring.all) {
    try {
      return open(candidate.key, iv, tag, ciphertext)
    } catch {
      // Wrong key: the GCM tag did not verify. Try the next one.
    }
  }
  throw new Error(
    "Encrypted secret could not be decrypted with any configured key"
  )
}

/**
 * True when `value` was written by the active key in the current write
 * format, i.e. a re-encryption pass has nothing to do for it.
 */
export function isOnActiveKey(value: Buffer): boolean {
  const ring = keyRing()
  if (!ring.keyedWrites) return value[0] === LEGACY_FORMAT
  return (
    value[0] === KEYED_FORMAT &&
    value.subarray(1, 1 + KEY_ID_BYTES).equals(ring.active.id)
  )
}

/**
 * What "on the active key" looks like in the stored bytes, so SQL can find
 * the rows a rotation still has to move without decrypting anything: the
 * format byte, and for the keyed format the 4-byte key id after it.
 */
export function activeKeyDescriptor():
  | { format: typeof LEGACY_FORMAT }
  | { format: typeof KEYED_FORMAT; keyId: Buffer } {
  const ring = keyRing()
  return ring.keyedWrites
    ? { format: KEYED_FORMAT, keyId: ring.active.id }
    : { format: LEGACY_FORMAT }
}

/** Decrypt with any accepted key and encrypt again with the active one. */
export function reencryptSecret(value: Buffer): Buffer {
  return encryptSecret(decryptSecret(value))
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function hmac(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("base64url")
}

function constantTimeEqual(expected: string, actual: string) {
  const left = Buffer.from(expected)
  const right = Buffer.from(actual)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * OAuth state is signed with its own secret, OAUTH_STATE_SECRET, rather than
 * NEXTAUTH_SECRET, so rotating one never touches the other. Until
 * OAUTH_STATE_SECRET is set, NEXTAUTH_SECRET signs as before. After it is
 * set, a state signed with NEXTAUTH_SECRET is still accepted while
 * OAUTH_STATE_ACCEPT_LEGACY is on (the default), which carries consents that
 * were mid-flight across the deploy; switch it off once a deploy has been
 * live longer than the state's ten-minute lifetime.
 */
export function signOAuthState(value: string): string {
  const env = getServerEnv()
  return hmac(env.OAUTH_STATE_SECRET ?? env.NEXTAUTH_SECRET, value)
}

export function verifyOAuthState(value: string, signature: string): boolean {
  const env = getServerEnv()
  if (constantTimeEqual(signOAuthState(value), signature)) return true
  if (env.OAUTH_STATE_SECRET && env.OAUTH_STATE_ACCEPT_LEGACY) {
    return constantTimeEqual(hmac(env.NEXTAUTH_SECRET, value), signature)
  }
  return false
}

export function secretEqual(
  provided: string | null | undefined,
  expected: string
) {
  const actual = Buffer.from(provided ?? "")
  const target = Buffer.from(expected)
  return actual.length === target.length && timingSafeEqual(actual, target)
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}
