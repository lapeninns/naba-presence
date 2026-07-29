import { redirect } from "next/navigation"

import { NabaPresenceDashboard } from "@/components/naba-presence/review-app"
import {
  getSession,
  isLocalBootstrapEnabled,
} from "@/lib/server/session"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  const allowAnonymous =
    process.env.NODE_ENV !== "production" ||
    isLocalBootstrapEnabled()
  if (!session && !allowAnonymous) redirect("/sign-in")
  return <NabaPresenceDashboard>{children}</NabaPresenceDashboard>
}
