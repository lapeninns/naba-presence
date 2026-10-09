import { PlusIcon } from "lucide-react"
import Link from "next/link"

import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { ListingsBoard } from "@/components/listings/listings-board"
import { buttonVariants } from "@/components/ui/button"
import { getSession } from "@/lib/server/session"
import { cn } from "@/lib/utils"

export const metadata = { title: "Listings · NabaPresence" }

/**
 * Every Google Business Profile the agency looks after, health first.
 * No `searchParams` here: the board reads its client filter on the client
 * so a filter change never re-renders the server segment.
 */
export default async function ListingsPage() {
  const session = await getSession()
  const canManage = session?.role === "owner" || session?.role === "admin"
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Listings"
        description="Every Google Business Profile you look after, and what each one is waiting on."
        actions={
          canManage ? (
            <Link href="/setup" className={cn(buttonVariants())}>
              <PlusIcon aria-hidden strokeWidth={1.75} />
              Add listings from Google
            </Link>
          ) : null
        }
      />
      <ListingsBoard role={session?.role ?? null} />
    </PageFrame>
  )
}
