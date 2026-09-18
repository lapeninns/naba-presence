import { SearchX } from "lucide-react"
import Link from "next/link"

import { PageEmptyState } from "@/components/app-shell/page-frame"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const metadata = { title: "Page not found · NabaPresence" }

/**
 * The root 404, outside the shell: no sidebar, so the one action is the way
 * back in.
 */
export default function NotFound() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center bg-canvas px-5 py-6 text-ink outline-none"
    >
      <PageEmptyState
        icon={<SearchX strokeWidth={1.75} aria-hidden />}
        title="Page not found"
        description="The page you’re looking for doesn’t exist or has moved."
        action={
          // A plain, real <a> styled as a button — Base UI's Button primitive
          // expects its `render` target to resolve to a native <button>, so
          // composing it with next/link would warn. `cn()` (not a bare
          // template literal) matters: buttonVariants' base string and its
          // variant string can target the same utility and only twMerge's
          // dedupe picks the right one.
          <Link href="/inbox" className={cn(buttonVariants())}>
            Go to Inbox
          </Link>
        }
      />
    </main>
  )
}
