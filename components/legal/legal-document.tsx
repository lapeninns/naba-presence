import { ChevronLeft } from "lucide-react"
import Link from "next/link"

import { BrandMark } from "@/components/app-shell/brand-mark"
import {
  assertLegalDetailsForProduction,
  LEGAL_OPERATOR,
} from "@/lib/legal/operator"
import { cn } from "@/lib/utils"

/**
 * A standalone link on a legal page (the contents, the footer): 44px tall on
 * touch (WCAG 2.5.8; the project floor), the focus halo, and the underline on
 * hover. Links inside running text stay inline and are exempt from the target
 * size.
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
 *
 * `contents` lists the page's sections, in order, for the "On this page"
 * list: plain fragment links, so it needs no JavaScript, and each page builds
 * it from the same object its `LegalSection`s read, so the two cannot drift.
 * Printing keeps only the document itself: the brand link, the contents and
 * the footer stay on screen.
 */
function LegalDocument({
  title,
  summary,
  current,
  contents = [],
  children,
}: {
  title: string
  summary: React.ReactNode
  /** Which legal page this is, so the footer marks it as the current page. */
  current?: "privacy" | "terms"
  /** The page's sections in order, for the "On this page" list. */
  contents?: ReadonlyArray<{ id: string; title: string }>
  children: React.ReactNode
}) {
  assertLegalDetailsForProduction()
  return (
    <div className="flex min-h-svh flex-col bg-canvas pt-safe px-safe pb-safe">
      <a
        href="#main"
        className="sr-only z-skip-link rounded-full bg-primary px-4 py-2 text-ui font-semibold text-primary-foreground focus-halo focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus-visible:outline-none print:hidden"
      >
        Skip to content
      </a>
      <header className="mx-auto flex h-(--np-appbar-h) w-full max-w-3xl items-center px-2 sm:mt-6 sm:px-4 print:hidden">
        <Link
          href="/"
          className="inline-flex min-h-(--np-touch) items-center gap-1 rounded-md px-2 text-ink-secondary focus-halo focus-visible:outline-none hover-fine:bg-fill"
          aria-label="NabaPresence home"
        >
          <ChevronLeft aria-hidden className="size-5" strokeWidth={1.5} />
          <BrandMark />
        </Link>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-3xl min-w-0 flex-col pt-2 pb-4 outline-none sm:px-6 sm:pt-4"
      >
        <article className="flex min-w-0 flex-col gap-8 px-4 py-4 wrap-break-word sm:rounded-(--np-radius-panel) sm:bg-surface sm:p-10 print:bg-transparent print:p-0 [&_code]:font-mono [&_code]:wrap-anywhere">
          <header className="flex flex-col gap-2">
            <h1 className="text-page-title font-semibold text-balance text-ink">
              {title}
            </h1>
            <p className="text-ui text-ink-muted">
              Effective {LEGAL_OPERATOR.effectiveDate}
            </p>
            <div className="max-w-prose text-body text-ink">{summary}</div>
          </header>
          {contents.length > 0 ? (
            <nav aria-labelledby="legal-contents" className="print:hidden">
              <h2
                id="legal-contents"
                className="text-ui font-semibold text-ink-muted"
              >
                On this page
              </h2>
              <ol className="mt-2 grid gap-x-6 sm:grid-cols-2">
                {contents.map((section) => (
                  <li key={section.id} className="flex">
                    <a
                      href={`#${section.id}`}
                      className={cn(LEGAL_NAV_LINK_CLASS, "text-ui text-ink")}
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          {children}
        </article>
      </main>
      <footer className="mx-auto w-full max-w-3xl px-4 pb-10 sm:px-6 sm:pb-16 print:hidden">
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

/**
 * One section, and the target of its contents link or a shared URL
 * (`/privacy#retention`): the heading keeps a little air above it when jumped
 * to, and is not printed alone at the foot of a page.
 */
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
      <h2
        id={id}
        className="scroll-mt-4 text-section font-semibold text-ink print:break-after-avoid"
      >
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
