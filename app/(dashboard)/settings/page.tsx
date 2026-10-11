import { PageHeader } from "@/components/app-shell/page-frame"
import { AgencyNameForm } from "@/components/settings/agency-name-form"
import { PolicyForm } from "@/components/settings/policy-form"
import { SettingsNav } from "@/components/settings/settings-nav"
import { UsageCard } from "@/components/settings/usage-card"
import { WorkspaceModeCard } from "@/components/settings/workspace-mode-card"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { withTenant } from "@/lib/server/db"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import { getSession } from "@/lib/server/session"
import { workspaceTerms } from "@/lib/workspace/terms"

export const metadata = { title: "Reply policy · NabaPresence" }

export default async function SettingsPolicyPage() {
  const session = await getSession()
  const role = session?.role ?? null
  const terms = workspaceTerms(session?.workspaceMode ?? "agency")
  // Owner-only and dark until the organisation's workspace_mode_change
  // feature is on; PATCH /api/organisations checks both again.
  const modeChangeAvailable =
    session?.role === "owner"
      ? await withTenant(session.organisationId, (sql) =>
          isOrgFeatureEnabled(
            sql,
            session.organisationId,
            "workspace_mode_change"
          )
        )
      : false
  return (
    <>
      <PageHeader
        title="Reply policy"
        description={`Your ${terms.orgLower}’s name, how replies are approved, how long raw review content is kept, and the defaults new work starts from.`}
        tabs={<SettingsNav role={role} />}
      />
      <div className="flex flex-col gap-(--np-gap-section)">
        {/* Saved on its own: the name is not part of the policy the save
            bar below submits. */}
        <Card flush>
          <CardHeader divided>
            <CardTitle as="h2">{terms.org}</CardTitle>
            <CardDescription>
              The name your team and invited people see.
            </CardDescription>
          </CardHeader>
          <CardContent className="py-(--np-card-pad)">
            <AgencyNameForm />
          </CardContent>
        </Card>
        {modeChangeAvailable ? <WorkspaceModeCard /> : null}
        <UsageCard />
        <PolicyForm role={role} />
      </div>
    </>
  )
}
