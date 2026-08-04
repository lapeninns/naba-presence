import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { cn } from "@/lib/utils"

// The zero-location state is the first thing a brand-new org sees, so it has
// to lead somewhere. The CTA is role-gated because
// app/(dashboard)/settings/connections/page.tsx redirects anyone who isn't an
// owner or admin back to /settings — an unconditional "Connect Google" button
// would bounce a member straight off the page they just clicked toward.
export function NoLocationEmpty({ role }: { role: string | null }) {
  const canConnect = role === "owner" || role === "admin"
  return (
    <Empty
      title="No business connected yet"
      description={
        canConnect
          ? "Connect Google Business Profile to manage your listing here."
          : "Ask an owner or admin to connect Google Business Profile."
      }
      action={
        canConnect ? (
          <Link href="/settings/connections" className={cn(buttonVariants())}>
            Connect Google
          </Link>
        ) : undefined
      }
    />
  )
}
