import { PageHeader } from "@/components/app-shell/page-frame"
import { AgencyNameForm } from "@/components/settings/agency-name-form"
import { PolicyForm } from "@/components/settings/policy-form"
import { SettingsNav } from "@/components/settings/settings-nav"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Reply policy · NabaPresence" }

export default async function SettingsPolicyPage() {
  const session = await getSession()
  const role = session?.role ?? null
  return (
    <>
      <PageHeader
        title="Reply policy"
        description="Your agency’s name, how replies are approved, how long raw review content is kept, and the defaults new work starts from."
        tabs={<SettingsNav role={role} />}
      />
      <div className="flex flex-col gap-(--np-gap-section)">
        {/* Saved on its own: the name is not part of the policy the save
            bar below submits. */}
        <Card flush>
          <CardHeader divided>
            <CardTitle as="h2">Agency</CardTitle>
            <CardDescription>
              The name your team and invited people see.
            </CardDescription>
          </CardHeader>
          <CardContent className="py-(--np-card-pad)">
            <AgencyNameForm />
          </CardContent>
        </Card>
        <PolicyForm role={role} />
      </div>
    </>
  )
}
