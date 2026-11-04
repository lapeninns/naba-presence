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
 *
 * The wordmark is the page's banner and the state is its main, so a screen
 * reader's landmarks say "NabaPresence" then "Page not found". The wordmark
 * is not a second link to the Inbox: one way back, said once.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-canvas pt-safe px-safe pb-safe text-ink">
      <header className="flex min-h-(--np-touch) items-center pt-10 sm:pt-0">
        <BrandMark size="lg" />
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="flex w-full justify-center pb-10 outline-none"
      >
        <NotFoundState className="w-full max-w-md px-5 sm:rounded-(--np-radius-card) sm:border sm:border-line sm:bg-surface sm:p-8">
          <Link
            href="/inbox"
            className={boundaryButtonClass("primary", "lg", "mt-3 w-full")}
          >
            {notFoundActionLabel("Inbox")}
          </Link>
        </NotFoundState>
      </main>
    </div>
  )
}
