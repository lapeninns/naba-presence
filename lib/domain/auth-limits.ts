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

/** A password's length in code points (see `PASSWORD_LENGTH`). */
export function passwordLength(value: string): number {
  return [...value].length
}
