import { Search } from "lucide-react"
import Link from "next/link"

import { BrandMark } from "@/components/app-shell/brand-mark"
import { EYEBROW_CLASS } from "@/components/app-shell/page-frame"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const metadata = { title: "Page not found · NabaPresence" }

/**
 * The root 404, outside the shell: no sidebar, so the page is the wordmark
 * and one card whose actions are the ways back in.
 */
export default function NotFound() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex min-h-svh flex-col items-center justify-center gap-6 bg-canvas px-4 py-10 text-ink outline-none"
    >
      <Link
        href="/inbox"
        className="rounded-md focus-halo focus-visible:outline-none"
      >
        <BrandMark size="lg" />
      </Link>
      <section
        aria-labelledby="not-found-title"
        className="flex w-full max-w-[460px] flex-col gap-4 rounded-2xl border border-line bg-surface p-[clamp(20px,5vw,32px)]"
      >
        <span
          aria-hidden
          className="grid size-11 place-items-center rounded-lg bg-fill text-ink-secondary"
        >
          <Search className="size-5" strokeWidth={1.75} />
        </span>
        <div className="flex flex-col gap-1.5">
          <p className={EYEBROW_CLASS}>Page not found · 404</p>
          <h1
            id="not-found-title"
            className="font-display text-page-title font-semibold text-balance"
          >
            Page not found
          </h1>
          <p className="text-body text-ink-muted">
            The page you’re looking for doesn’t exist or has moved. Nothing was
            changed.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Link
            href="/inbox"
            className={cn(buttonVariants({ size: "lg" }), "w-full")}
          >
            Go to Inbox
          </Link>
        </div>
      </section>
    </main>
  )
}
