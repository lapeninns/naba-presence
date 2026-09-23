/**
 * Who operates NabaPresence, as the privacy notice and terms name them.
 *
 * The bracketed values are placeholders the operator must replace before the
 * legal pages go live: Google's OAuth consent screen links to these pages,
 * and a placeholder there is a statement nobody made.
 * `tests/components/legal-pages.test.tsx` checks the pages render them, and
 * `hasLegalPlaceholders()` reports whether any remain.
 */
export const LEGAL_OPERATOR = {
  /** The registered legal entity, e.g. "Example Inns Ltd". */
  legalName: "[LEGAL ENTITY NAME]",
  /** Registered office address, one line. */
  registeredAddress: "[REGISTERED ADDRESS]",
  /** Where privacy questions and requests go. */
  privacyEmail: "[PRIVACY CONTACT EMAIL]",
  /**
   * Who hosts the production database and where, e.g. "Supabase (EU, Ireland)".
   * Chosen when production is re-provisioned (docs/runbook.md).
   */
  databaseHost: "[DATABASE HOST AND REGION]",
  /** The date these versions take effect, e.g. "1 October 2026". */
  effectiveDate: "[EFFECTIVE DATE]",
} as const

/** True while any operator detail is still a placeholder. */
export function hasLegalPlaceholders(): boolean {
  return Object.values(LEGAL_OPERATOR).some((value) => /^\[.*\]$/.test(value))
}
