import { HydrationBoundary } from "@/lib/queries/hydration-boundary"

import { PageHeader } from "@/components/app-shell/page-frame"
import { PolicyForm } from "@/components/settings/policy-form"
import { SettingsNav } from "@/components/settings/settings-nav"
import { UsageCard } from "@/components/settings/usage-card"
import { WorkspaceModeCard } from "@/components/settings/workspace-mode-card"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import { prefetch, replyPolicyPrefetch } from "@/lib/server/prefetch"
import type { getSession } from "@/lib/server/session"
import { workspaceTerms } from "@/lib/workspace/terms"

/**
 * The Reply policy page body, served at /settings (the desk's settings
 * home) and /settings/policy (where the phone's settings index leads).
 *
 * One save model for the page (components/settings/policy-form.tsx): the
 * name and the policy are one form with one dirty-only save bar and one
 * leave guard. The workspace-type and credits cards below the form are
 * read-outs or their own confirmed actions, never part of that save. The
 * settings the form edits are read on the server (`replyPolicyPrefetch`), so
 * the form paints filled in rather than as a skeleton.
 */
export async function ReplyPolicyContent({
  session,
}: {
  session: Awaited<ReturnType<typeof getSession>>
}) {
  const role = session?.role ?? null
  const terms = workspaceTerms(session?.workspaceMode ?? "agency")
  const billingEnabled = getServerEnv().BILLING_ENABLED
  // Owner-only and dark until the organisation's workspace_mode_change
  // feature is on; PATCH /api/organisations checks both again.
  const [modeChangeAvailable, state] = await Promise.all([
    session?.role === "owner"
      ? withTenant(session.organisationId, (sql) =>
          isOrgFeatureEnabled(
            sql,
            session.organisationId,
            "workspace_mode_change"
          )
        )
      : false,
    prefetch(session, replyPolicyPrefetch()),
  ])
  return (
    <>
      <PageHeader
        title="Reply policy"
        description={`Your ${terms.orgLower}’s name, how replies are approved, how long review text is kept, and the defaults new work starts from.`}
        tabs={<SettingsNav role={role} />}
      />
      <div className="flex flex-col gap-(--np-gap-section)">
        <HydrationBoundary state={state}>
          <PolicyForm role={role} />
        </HydrationBoundary>
        {modeChangeAvailable ? (
          <WorkspaceModeCard billingEnabled={billingEnabled} />
        ) : null}
        {/* With billing on, credits live on the shared Usage screen. */}
        {billingEnabled ? null : <UsageCard />}
      </div>
    </>
  )
}
