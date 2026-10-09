import { InvitationView } from "@/components/auth/invitation-view"
import { QueryProvider } from "@/lib/queries/provider"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Accept invitation · NabaPresence" }

export default async function InvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ mode?: string }>
}) {
  const { token } = await params
  const { mode } = await searchParams
  const session = await getSession()
  return (
    <QueryProvider>
      <InvitationView
        token={token}
        initialMode={mode === "sign-in" ? "sign-in" : "create-account"}
        viewer={
          session
            ? { displayName: session.displayName, email: session.email }
            : null
        }
      />
    </QueryProvider>
  )
}
