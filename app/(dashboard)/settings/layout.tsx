import { SettingsNav } from "@/components/settings/settings-nav"
import { PageFrame } from "@/components/app-shell/page-frame"
import { getSession } from "@/lib/server/session"

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  return (
    <PageFrame width="standard">
      <SettingsNav role={session?.role ?? null} />
      {children}
    </PageFrame>
  )
}
