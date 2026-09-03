import Link from "next/link"

import { PageFrame } from "@/components/app-shell/page-frame"
import { buttonVariants } from "@/components/ui/button"

/**
 * Inside the shell, not the bare root 404: someone who follows a stale link to
 * a deleted client should still have their navigation, not be dropped onto a
 * blank page with one link back.
 */
export default function DashboardNotFound() {
  return (
    <PageFrame>
      <div className="mx-auto flex max-w-md flex-col items-start gap-4 py-16">
        <h1 className="font-display text-page-title">We couldn&rsquo;t find that</h1>
        <p className="text-body text-ink-muted">
          The client or location you followed may have been removed, or the link
          may be wrong.
        </p>
        <Link href="/clients" className={buttonVariants({ variant: "outline" })}>
          Back to Clients
        </Link>
      </div>
    </PageFrame>
  )
}
