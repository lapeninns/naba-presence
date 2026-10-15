import Link from "next/link"

import {
  boundaryButtonClass,
  NOT_FOUND_TITLE,
  notFoundActionLabel,
  NotFoundState,
} from "@/components/app-shell/boundary"
import { BrandMark } from "@/components/app-shell/brand-mark"

export const metadata = { title: `${NOT_FOUND_TITLE} · NabaPresence` }

/**
 * The root 404, outside the shell: no sidebar, so the page is the wordmark
 * and a calm, centred empty state whose one action is the way back in. On a
 * phone it sits on the canvas; from `sm` it gets a card. Its words come from
 * `NotFoundState`, shared with the 404 inside the shell.
 */
export default function NotFound() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="flex min-h-svh flex-col items-center justify-center gap-6 bg-canvas py-10 px-safe text-ink outline-none"
    >
      <Link
        href="/inbox"
        className="inline-flex min-h-(--np-touch) items-center rounded-md focus-halo focus-visible:outline-none"
      >
        <BrandMark size="lg" />
      </Link>
      <NotFoundState className="w-full max-w-md px-5 sm:rounded-2xl sm:border sm:border-line sm:bg-surface sm:p-8">
        <Link
          href="/inbox"
          className={boundaryButtonClass("primary", "lg", "mt-3 w-full")}
        >
          {notFoundActionLabel("Inbox")}
        </Link>
      </NotFoundState>
    </main>
  )
}
