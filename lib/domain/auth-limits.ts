// Bounds shared by the auth schemas (./auth) and client code that must check
// them without loading zod.

/** A password-reset link's `tokenHash` length, in UTF-16 code units. */
export const RESET_TOKEN_HASH_LENGTH = { min: 20, max: 512 } as const

/**
 * A password's length bounds, counted in Unicode code points, as NIST SP
 * 800-63B counts characters (one emoji is one character, not the two UTF-16
 * code units `String.length` sees).
 */
export const PASSWORD_LENGTH = { min: 12, max: 128 } as const

/**
 * The most UTF-16 code units a password within `PASSWORD_LENGTH` can have
 * (a code point is one or two units). Every schema that takes an existing
 * password (sign-in, MFA) caps at this, so anything a person could set can
 * still be typed back in.
 */
export const PASSWORD_MAX_CODE_UNITS = PASSWORD_LENGTH.max * 2

/** A password's length in code points (see `PASSWORD_LENGTH`). */
export function passwordLength(value: string): number {
  return [...value].length
}
