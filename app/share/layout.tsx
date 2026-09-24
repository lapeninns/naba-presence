import type { Metadata } from "next"

/**
 * Public, tokenised pages (`/share/**`): outside the (dashboard) group, so no
 * session, no sidebar, no navigation into the app.
 *
 * The links are secret and must stay unindexed and unshared by accident:
 * robots noindex/nofollow here, plus X-Robots-Tag, Referrer-Policy:
 * no-referrer and Cache-Control: private, no-store as response headers
 * (next.config.ts `SHARE_HEADERS`), so the token in the address never leaves
 * in a Referer and no shared cache keeps a copy. The metadata sits on the
 * layout so the not-found page carries it too.
 */
export const metadata: Metadata = {
  title: "Client report",
  description: "A read-only performance report.",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
}

export default function ShareLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-svh bg-canvas text-ink print:bg-white">
      {children}
    </div>
  )
}
