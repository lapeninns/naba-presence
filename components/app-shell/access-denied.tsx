import { Lock } from "lucide-react"
import Link from "next/link"

import { PageEmptyState, PageFrame } from "@/components/app-shell/page-frame"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * An explicit "you don't have access" page.
 *
 * Every role-gated route used to `redirect()` somewhere else, so a member who
 * followed a colleague's link to Connections silently landed on the policy
 * page with no explanation. Being told what you cannot reach, and who can
 * grant it, is the difference between a permission model and a bug.
 *
 * Renders NO landmark of its own. Some callers sit inside a layout that
 * already owns the page's single `<main>` (Settings does), and a second one
 * breaks `landmark-no-duplicate-main`, which the axe suite pins. Routes with
 * no frame of their own use `AccessDeniedPage`.
 */
function AccessDenied({
  area,
  whoCanHelp = "an owner or admin",
}: {
  /** What they tried to reach, in the product's own words. */
  area: string
  whoCanHelp?: string
}) {
  return (
    <PageEmptyState
      icon={<Lock strokeWidth={1.75} aria-hidden />}
      title="You don’t have access to this page"
      description={`${area} is limited to ${whoCanHelp}. Ask ${whoCanHelp} in your agency if you need it.`}
      action={
        <Link
          href="/inbox"
          className={cn(buttonVariants({ variant: "secondary" }))}
        >
          Back to Inbox
        </Link>
      }
    />
  )
}

/** The same message for a route that owns its own page frame. */
function AccessDeniedPage(props: React.ComponentProps<typeof AccessDenied>) {
  return (
    <PageFrame>
      <AccessDenied {...props} />
    </PageFrame>
  )
}

export { AccessDenied, AccessDeniedPage }
