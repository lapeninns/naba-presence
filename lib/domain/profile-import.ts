// Pure proposal builder for the profile import-review surface. Consumes the
// field comparisons already computed by lib/server/profile.ts (statuses via
// classifyProfileField) and stages google_dirty/conflict fields as
// suggestion-only proposals.
import type { ProfileFieldPatch } from "@/lib/domain/import-review"
import type {
  ProfileDriftStatus,
  ProfileFieldKey,
  ProfileFieldPolicy,
} from "@/lib/domain/profile"

export type ProfileFieldComparison = {
  key: ProfileFieldKey
  policy: ProfileFieldPolicy
  status: ProfileDriftStatus
  canonicalValue: string | null
  googleValue: string | null
  lastReconciledAt: string | null
}

export type ProfileProposalDraft = {
  kind: "field_changed"
  identityKey: string
  fieldKey: ProfileFieldKey
  canonicalValue: string | null
  googleValue: string | null
  suggestedPatch: ProfileFieldPatch
  warnings: string[]
}

export function buildProfileProposals(input: {
  fields: ProfileFieldComparison[]
}): ProfileProposalDraft[] {
  const proposals: ProfileProposalDraft[] = []
  for (const field of input.fields) {
    if (field.status !== "google_dirty" && field.status !== "conflict") continue
    if (field.policy === "google_read_only") continue
    // Empty on Google never blanks local data — no proposal, matching the
    // menu differ's minimal-diff rule.
    if (field.googleValue === null) continue
    const warnings: string[] = []
    if (field.status === "conflict") {
      warnings.push(
        field.lastReconciledAt
          ? "canonical_also_changed"
          : "no_baseline"
      )
    }
    proposals.push({
      kind: "field_changed",
      identityKey: field.key,
      fieldKey: field.key,
      canonicalValue: field.canonicalValue,
      googleValue: field.googleValue,
      suggestedPatch: {
        op: "set_field",
        fieldKey: field.key,
        value: field.googleValue,
      },
      warnings,
    })
  }
  return proposals
}
