// Bounds shared by the auth schemas (./auth) and client code that must check
// them without loading zod.

/** A password-reset link's `tokenHash` length, in UTF-16 code units. */
export const RESET_TOKEN_HASH_LENGTH = { min: 20, max: 512 } as const
