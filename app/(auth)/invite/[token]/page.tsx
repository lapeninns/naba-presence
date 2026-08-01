import { InvitationView } from "@/components/auth/invitation-view"
import { QueryProvider } from "@/lib/queries/provider"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Accept invitation · NabaPresence" }

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const session = await getSession()
  return (
    <QueryProvider>
      <InvitationView
        token={token}
        viewer={
          session
            ? { displayName: session.displayName, email: session.email }
            : null
        }
      />
    </QueryProvider>
  )
}
