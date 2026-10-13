import Link from "next/link"

import { BrandMark } from "@/components/app-shell/brand-mark"
import {
  assertLegalDetailsForProduction,
  LEGAL_OPERATOR,
} from "@/lib/legal/operator"
import { cn } from "@/lib/utils"

/**
 * A standalone link out of a legal page: 44px tall on touch (WCAG 2.5.8; the
 * project floor), the focus halo, and the underline on hover. Links inside
 * running text stay inline and are exempt from the target size.
 */
const LEGAL_NAV_LINK_CLASS =
  "inline-flex min-h-6 items-center rounded-sm underline-offset-4 focus-halo hover:underline focus-visible:outline-none aria-[current=page]:font-semibold aria-[current=page]:text-ink pointer-coarse:min-h-(--np-touch)"

/** A link inside running text: inline, underlined, with the focus halo. */
const INLINE_LINK_CLASS =
  "rounded-sm underline underline-offset-4 focus-halo focus-visible:outline-none"

const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy policy", page: "privacy" },
  { href: "/terms", label: "Terms of service", page: "terms" },
  { href: "/sign-in", label: "Sign in", page: null },
] as const

/**
 * The frame both legal pages share: the brand, a title, the effective date,
 * then plain sections. Static on purpose — no session, no database, no client
 * JavaScript — because Google's consent screen links here and a reviewer
 * with no account must be able to read it even while the app is down.
 *
 * Phone first: the page pads itself clear of the notch and home indicator
 * (`px-safe`, `pb-safe`), running text is `text-body` (16px on touch) held to
 * a readable measure, and anything unbreakable (a scope URL, an email
 * address) wraps instead of pushing the page sideways at 320px (WCAG 1.4.10).
 */
function LegalDocument({
  title,
  summary,
  current,
  children,
}: {
  title: string
  summary: React.ReactNode
  /** Which legal page this is, so the footer marks it as the current page. */
  current?: "privacy" | "terms"
  children: React.ReactNode
}) {
  assertLegalDetailsForProduction()
  return (
    <div className="flex min-h-svh flex-col bg-canvas px-safe pb-safe">
      <a
        href="#main"
        className="sr-only z-skip-link rounded-full bg-primary px-4 py-2 text-ui font-semibold text-primary-foreground focus-halo focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-visible:outline-none print:hidden"
      >
        Skip to content
      </a>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 px-4 pt-6 pb-4 outline-none sm:px-6 sm:pt-16"
      >
        <Link
          href="/"
          className="inline-flex min-h-(--np-touch) items-center self-start rounded-sm focus-halo focus-visible:outline-none"
          aria-label="NabaPresence home"
        >
          <BrandMark />
        </Link>
        <article className="flex min-w-0 flex-col gap-8 rounded-(--np-radius-panel) bg-surface p-5 wrap-break-word sm:p-10 [&_code]:font-mono [&_code]:wrap-anywhere">
          <header className="flex flex-col gap-2">
            <h1 className="text-page-title font-bold text-balance text-ink">
              {title}
            </h1>
            <p className="text-ui text-ink-muted">
              Effective {LEGAL_OPERATOR.effectiveDate}
            </p>
            <div className="max-w-prose text-body text-ink">{summary}</div>
          </header>
          {children}
        </article>
      </main>
      <footer className="mx-auto w-full max-w-3xl px-4 pb-10 sm:px-6 sm:pb-16">
        <nav
          aria-label="Legal"
          className="flex flex-wrap gap-x-5 gap-y-1 text-ui text-ink-muted"
        >
          {LEGAL_LINKS.map((link) => (
            <Link
              key={link.href}
              className={LEGAL_NAV_LINK_CLASS}
              href={link.href}
              aria-current={
                link.page !== null && link.page === current ? "page" : undefined
              }
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  )
}

function LegalSection({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <h2 id={id} className="text-section font-semibold text-ink">
        {title}
      </h2>
      <div
        data-slot="legal-section-body"
        className={cn(
          "flex max-w-prose min-w-0 flex-col gap-3 text-body text-ink",
          "[&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5"
        )}
      >
        {children}
      </div>
    </section>
  )
}

export { INLINE_LINK_CLASS, LegalDocument, LegalSection }
