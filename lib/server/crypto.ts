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

function encryptionKey() {
  return createHash("sha256")
    .update(getServerEnv().TOKEN_ENCRYPTION_KEY, "utf8")
    .digest()
}

export function encryptSecret(value: string): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([1]), iv, tag, ciphertext])
}

export function decryptSecret(value: Buffer): string {
  if (value[0] !== 1 || value.length < 30) {
    throw new Error("Unsupported encrypted secret format")
  }
  const iv = value.subarray(1, 13)
  const tag = value.subarray(13, 29)
  const ciphertext = value.subarray(29)
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8")
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

export function signValue(value: string): string {
  return createHmac("sha256", getServerEnv().NEXTAUTH_SECRET)
    .update(value)
    .digest("base64url")
}

export function verifySignedValue(value: string, signature: string): boolean {
  const expected = Buffer.from(signValue(value))
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
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
