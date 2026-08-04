import { ProfileNav } from "@/components/locations/profile-nav"
import { getSession } from "@/lib/server/session"

// Sub-nav only — no PageFrame. (business)/layout.tsx above owns the <main>,
// exactly as app/(dashboard)/settings/layout.tsx relates to its pages.
export default async function ProfileLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  return (
    <div className="flex flex-col gap-6">
      <ProfileNav role={session?.role ?? null} />
      {children}
    </div>
  )
}
