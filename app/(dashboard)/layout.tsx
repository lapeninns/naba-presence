import { NabaPresenceDashboard } from "@/components/naba-presence/review-app"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <NabaPresenceDashboard>{children}</NabaPresenceDashboard>
}
