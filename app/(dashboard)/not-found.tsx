"use client"

import { ArrowLeft, Search } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  BoundaryFrame,
  boundaryButtonClass,
  notFoundActionLabel,
  NotFoundState,
} from "@/components/app-shell/boundary"
import { useShellBack } from "@/components/app-shell/breadcrumbs-context"
import {
  openCommandPalette,
  useShortcutHint,
} from "@/components/app-shell/command-palette"
import { SupportDetails } from "@/components/editors/support-details"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * Inside the shell, not the bare root 404: someone who follows a stale link to
 * a deleted client should still have their navigation. The navigation already
 * lists every destination, so this page does not repeat them.
 *
 * The look is a calm, centred empty state (an outline icon, the title, why,
 * one primary action). The primary action is the shell's own back target, the
 * same place the app bar's back control goes ("Back to Clients" for a stale
 * client link), with the Inbox as the way home when the shell has no parent
 * to offer. The address they asked for is for whoever supports them, so it
 * sits behind "Details for support" rather than in the sentence.
 *
 * Words and layout come from `NotFoundState`, shared with the root 404. Plain
 * markup and the light helpers in components/app-shell/boundary.tsx only (the
 * palette module is the shell's own, already loaded): this file is bundled
 * into every dashboard segment's not-found chunk.
 */
export default function DashboardNotFound() {
  const pathname = usePathname()
  const shortcut = useShortcutHint()
  const business = useWorkspaceMode() === "business"
  const back = useShellBack() ?? { href: "/inbox", label: "Inbox" }

  return (
    <BoundaryFrame>
      <NotFoundState className="pt-6 sm:pt-12 lg:pt-16">
        <div className="mt-3 flex w-full max-w-sm flex-col items-stretch gap-1 sm:w-auto sm:items-center">
          <Link
            href={back.href}
            className={boundaryButtonClass(
              "primary",
              "default",
              "pointer-coarse:min-h-11"
            )}
          >
            <ArrowLeft strokeWidth={1.75} aria-hidden />
            {notFoundActionLabel(back.label)}
          </Link>
          <button
            type="button"
            className={boundaryButtonClass(
              "ghost",
              "default",
              "text-ink-secondary pointer-coarse:min-h-11"
            )}
            onClick={openCommandPalette}
          >
            <Search strokeWidth={1.75} aria-hidden />
            {business ? "Search listings" : "Search clients and listings"}
            <kbd
              aria-hidden
              className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-b-2 border-line bg-surface px-1 font-mono text-caption text-ink-muted tabular-nums max-md:hidden"
            >
              {shortcut}
            </kbd>
          </button>
        </div>
        <SupportDetails items={[pathname]} className="mt-1" />
      </NotFoundState>

      <section
        aria-labelledby="link-help"
        className="mx-auto flex w-full max-w-md flex-col gap-1 px-3 text-center"
      >
        <h2 id="link-help" className="text-ui font-medium text-ink">
          Followed a link from a teammate?
        </h2>
        <p className="text-caption text-pretty text-ink-muted">
          {business
            ? "Ask them to open it again. If it still fails, the listing was probably removed. If you can’t see a location they can, an owner or admin can give you access from the Team page."
            : "Ask them to open it again. If it still fails, the client or listing was probably removed. If you can’t see a client they can, an owner or admin can give you access from the Team page."}
        </p>
      </section>
    </BoundaryFrame>
  )
}
