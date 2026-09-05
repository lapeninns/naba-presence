import { PolicyForm } from "@/components/settings/policy-form"
import { PageHeader } from "@/components/app-shell/page-frame"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Reply policy · NabaPresence" }

export default async function SettingsPolicyPage() {
  const session = await getSession()
  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <PageHeader
        title="Reply policy"
        description="How replies are approved and how long raw review content is kept."
      />
      <PolicyForm role={session?.role ?? null} />
    </div>
  )
}
