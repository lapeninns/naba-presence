import "server-only"

import { createHash } from "node:crypto"

/**
 * How Google identifies a refresh token in a RISC token-revoked event
 * (developers.google.com/identity/protocols/risc): either
 * `hash_base64_sha512_sha512`, the base64 of SHA-512 applied twice, or
 * `prefix`, the token's first 16 characters. Google's page does not say
 * whether the inner digest is raw bytes or hex; this follows Google's own
 * sample receiver, which hashes the raw bytes. The prefix is never stored in
 * the clear, only its SHA-256.
 */
export function riscTokenHash(refreshToken: string): string {
  const inner = createHash("sha512").update(refreshToken, "utf8").digest()
  return createHash("sha512").update(inner).digest("base64")
}

export function riscPrefixHash(prefix: string): string {
  return createHash("sha256").update(prefix.slice(0, 16), "utf8").digest("hex")
}

export function refreshTokenFingerprints(refreshToken: string) {
  return {
    sha512x2: riscTokenHash(refreshToken),
    prefixSha256: riscPrefixHash(refreshToken),
  }
}
