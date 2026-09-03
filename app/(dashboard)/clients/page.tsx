import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { ClientsIndex, NewClientButton } from "@/components/clients/clients-index"
import { buttonVariants } from "@/components/ui/button"
import { getSession } from "@/lib/server/session"
import Link from "next/link"

export const metadata = { title: "Clients · NabaPresence" }

export default async function ClientsPage() {
  const session = await getSession()
  const canManage = session?.role === "owner" || session?.role === "admin"

  return (
    <PageFrame width="wide">
      <PageHeader
        title="Clients"
        description="Every business you look after, and what each one needs."
        actions={
          <>
            <Link
              href="/locations"
              className={buttonVariants({ variant: "outline" })}
            >
              All locations
            </Link>
            {canManage ? <NewClientButton /> : null}
          </>
        }
      />
      <ClientsIndex role={session?.role ?? null} />
    </PageFrame>
  )
}
