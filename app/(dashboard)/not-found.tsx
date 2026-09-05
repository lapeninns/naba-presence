import { SearchX } from "lucide-react"
import Link from "next/link"

import { PageEmptyState, PageFrame } from "@/components/app-shell/page-frame"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Inside the shell, not the bare root 404: someone who follows a stale link to
 * a deleted client should still have their navigation, not be dropped onto a
 * blank page with one link back.
 */
export default function DashboardNotFound() {
  return (
    <PageFrame>
      <PageEmptyState
        icon={<SearchX strokeWidth={1.75} aria-hidden />}
        title="We couldn’t find that"
        description="The client or location you followed may have been removed, or the link may be wrong."
        action={
          <Link
            href="/clients"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            Back to Clients
          </Link>
        }
      />
    </PageFrame>
  )
}
