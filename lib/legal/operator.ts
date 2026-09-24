/**
 * Who operates NabaPresence, as the privacy notice and terms name them.
 *
 * Bracketed values are placeholders the operator must replace before the
 * legal pages go live: Google's OAuth consent screen links to these pages,
 * and a placeholder there is a statement nobody made. The operator is a sole
 * trader, so there is no registered office; an empty address is left out of
 * the pages rather than treated as a placeholder.
 * `tests/components/legal-pages.test.tsx` checks the pages render them, and
 * `hasLegalPlaceholders()` reports whether any remain.
 */
export const LEGAL_OPERATOR = {
  /** The data controller: a person or a registered entity, e.g. "Example Inns Ltd". */
  legalName: "Aman Kumar Shrestha",
  /** Registered office address, one line. Empty for a sole trader. */
  registeredAddress: "",
  /** Where privacy questions and requests go. */
  privacyEmail: "amanshresthaaaaa@gmail.com",
  /**
   * Who hosts the production database and where, e.g. "Supabase (EU, Ireland)".
   * Chosen when production is re-provisioned (docs/runbook.md).
   */
  databaseHost: "Supabase (United States, N. Virginia)",
  /** The date these versions take effect, e.g. "1 October 2026". */
  effectiveDate: "1 October 2026",
} as const

/** True while any operator detail is still a placeholder. */
export function hasLegalPlaceholders(
  operator: Record<string, string> = LEGAL_OPERATOR
): boolean {
  return Object.values(operator).some((value) => /^\[.*\]$/.test(value))
}

/**
 * Stops a Vercel production build that would publish placeholder operator
 * details. The legal pages are prerendered, so throwing while rendering them
 * fails the build. Previews and local builds keep rendering the brackets, so
 * the wording can be reviewed before the details are known.
 */
export function assertLegalDetailsForProduction(
  env: Record<string, string | undefined> = process.env,
  operator: Record<string, string> = LEGAL_OPERATOR
) {
  if (env.VERCEL_ENV === "production" && hasLegalPlaceholders(operator)) {
    throw new Error(
      "lib/legal/operator.ts still has placeholder operator details. Fill them in before a production deploy: Google's consent screen links to these pages."
    )
  }
}
