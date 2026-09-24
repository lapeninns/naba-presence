import Link from "next/link"

import { BrandMark } from "@/components/app-shell/brand-mark"
import {
  assertLegalDetailsForProduction,
  LEGAL_OPERATOR,
} from "@/lib/legal/operator"

/**
 * The frame both legal pages share: the brand, a title, the effective date,
 * then plain sections. Static on purpose — no session, no database, no client
 * JavaScript — because Google's consent screen links here and a reviewer
 * with no account must be able to read it even while the app is down.
 */
function LegalDocument({
  title,
  summary,
  children,
}: {
  title: string
  summary: React.ReactNode
  children: React.ReactNode
}) {
  assertLegalDetailsForProduction()
  return (
    <div className="flex min-h-svh flex-col bg-canvas">
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-10 outline-none sm:py-16"
      >
        <Link href="/" className="self-start" aria-label="NabaPresence home">
          <BrandMark />
        </Link>
        <article className="flex flex-col gap-8 rounded-(--np-radius-panel) bg-surface p-6 sm:p-10">
          <header className="flex flex-col gap-2">
            <h1 className="text-page-title font-bold text-balance text-ink">
              {title}
            </h1>
            <p className="text-ui text-ink-muted">
              Effective {LEGAL_OPERATOR.effectiveDate}
            </p>
            <div className="text-body text-ink">{summary}</div>
          </header>
          {children}
        </article>
        <nav
          aria-label="Legal"
          className="flex flex-wrap gap-x-5 gap-y-2 text-ui text-ink-muted"
        >
          <Link className="underline-offset-4 hover:underline" href="/privacy">
            Privacy policy
          </Link>
          <Link className="underline-offset-4 hover:underline" href="/terms">
            Terms of service
          </Link>
          <Link className="underline-offset-4 hover:underline" href="/sign-in">
            Sign in
          </Link>
        </nav>
      </main>
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
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-section font-semibold text-ink">
        {title}
      </h2>
      <div className="flex flex-col gap-3 text-body text-ink [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        {children}
      </div>
    </section>
  )
}

export { LegalDocument, LegalSection }
