import { PageHeader } from "@/components/app-shell/page-frame"
import { PolicyForm } from "@/components/settings/policy-form"
import { SettingsNav } from "@/components/settings/settings-nav"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Reply policy · NabaPresence" }

export default async function SettingsPolicyPage() {
  const session = await getSession()
  const role = session?.role ?? null
  return (
    <>
      <PageHeader
        title="Reply policy"
        description="How replies are approved, how long raw review content is kept, and the defaults new work starts from. Changes apply once you save."
        tabs={<SettingsNav role={role} />}
      />
      <PolicyForm role={role} />
    </>
  )
}
