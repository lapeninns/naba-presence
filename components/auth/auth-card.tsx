import {
  Inbox,
  KeyRound,
  Link2,
  PencilLine,
  Send,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"

import { BrandGlyph, BrandMark } from "@/components/app-shell/brand-mark"
import { EYEBROW_CLASS } from "@/components/app-shell/page-frame"
import { cn } from "@/lib/utils"

type AsideVariant = "product" | "recovery" | "reset" | "invite"

type Beat = { icon: LucideIcon; title?: string; text: string }

/**
 * What the charcoal panel says on each screen. Product statements only: what
 * NabaPresence does and what an account change does or does not touch. No
 * figures, customers or testimonials, because the panel has no data to back
 * them.
 */
const ASIDES: Record<
  AsideVariant,
  { label: string; statement: string; beats: Beat[]; footnote: string }
> = {
  product: {
    label: "About NabaPresence",
    statement: "Google reviews and listings, run from one desk.",
    beats: [
      {
        icon: Inbox,
        title: "Every review in one inbox",
        text: "Needs reply, approval and failed publishes, across every pub and restaurant you look after.",
      },
      {
        icon: ShieldCheck,
        title: "Approve replies before they go live",
        text: "Drafts are checked against your reply policy, and a reply can need a second person’s approval.",
      },
      {
        icon: Send,
        title: "Publish to each Business Profile",
        text: "Changes go out through the profile’s own Google connection and show as live only once Google confirms.",
      },
    ],
    footnote:
      "For hospitality businesses, and for the agencies that manage their Google Business Profiles.",
  },
  recovery: {
    label: "About account recovery",
    statement: "Resetting your password changes only your sign-in.",
    beats: [
      {
        icon: Link2,
        text: "Every Google connection keeps working. Nothing is disconnected or re-authorised.",
      },
      {
        icon: PencilLine,
        text: "Drafts and approvals stay where you left them.",
      },
    ],
    footnote:
      "Locked out of a Google login instead? An owner or admin can reconnect it from Settings.",
  },
  reset: {
    label: "About account recovery",
    statement: "A new password for you. Nothing else changes.",
    beats: [
      {
        icon: Link2,
        text: "Every Google connection keeps working. Nothing is disconnected or re-authorised.",
      },
      {
        icon: KeyRound,
        text: "Pick something you don’t use anywhere else. A password manager can generate one.",
      },
    ],
    footnote:
      "If this link has expired, request another from the sign-in page.",
  },
  invite: {
    label: "About NabaPresence",
    statement: "You’ve been asked to help look after Google reviews.",
    beats: [
      {
        icon: Inbox,
        title: "Every review in one inbox",
        text: "You see the reviews and listings your role and access allow.",
      },
      {
        icon: ShieldCheck,
        title: "Approve replies before they go live",
        text: "Your role decides whether you draft, approve or publish.",
      },
      {
        icon: Send,
        title: "Publish to each Business Profile",
        text: "Through the Google logins already connected. You don’t connect your own.",
      },
    ],
    footnote:
      "Invitations are sent by an owner or admin and work for one email address.",
  },
}

/**
 * The charcoal half of the split layout, from `lg` (64rem). Below that the
 * compact wordmark above the card takes its place.
 */
function AuthAside({ variant }: { variant: AsideVariant }) {
  const aside = ASIDES[variant]
  return (
    <aside
      aria-label={aside.label}
      className="hidden flex-col justify-between gap-8 bg-charcoal p-12 text-ink-on-charcoal lg:flex xl:p-16"
    >
      <Link
        href="/sign-in"
        className="flex w-fit items-center gap-2.5 rounded-md focus-halo focus-visible:outline-none"
      >
        <BrandGlyph inverse />
        <span className="text-title font-semibold" translate="no">
          NabaPresence
        </span>
      </Link>
      <div className="flex flex-col gap-8">
        <p className="max-w-88 font-display text-display font-semibold text-balance">
          {aside.statement}
        </p>
        <ul className="flex max-w-96 flex-col gap-5">
          {aside.beats.map((beat) => (
            <li
              key={beat.text}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3.5"
            >
              <span
                aria-hidden
                className="grid size-9 place-items-center rounded-lg ring-1 ring-ink-muted-on-charcoal ring-inset"
              >
                <beat.icon className="size-4" strokeWidth={1.75} />
              </span>
              <div className={cn(!beat.title && "self-center")}>
                {beat.title ? (
                  <p className="text-title font-semibold">{beat.title}</p>
                ) : null}
                <p
                  className={cn(
                    "text-ui",
                    beat.title
                      ? "mt-0.5 text-ink-muted-on-charcoal"
                      : "text-ink-on-charcoal"
                  )}
                >
                  {beat.text}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-caption text-ink-muted-on-charcoal">
        {aside.footnote}
      </p>
    </aside>
  )
}

/**
 * Every anonymous page's first tab stop: jumps past the product panel's
 * links to the card. Off-screen until focused.
 */
const SKIP_LINK_CLASS =
  "fixed top-3 left-3 z-skip-link mt-(--np-safe-top) ml-(--np-safe-left) -translate-y-24 rounded-full bg-primary px-4 py-2 text-ui font-semibold text-primary-foreground no-underline focus-halo focus:translate-y-0 focus:shadow-np-pop focus-visible:outline-none motion-safe:transition-transform"

/**
 * A caption link that stays a 44px target on touch (the project floor) and
 * earns back its compact height only at the desk. Height, not padding, so
 * the row's visual rhythm is unchanged and only the tap area grows.
 */
const TOUCH_LINK_CLASS =
  "inline-flex min-h-(--np-touch) items-center desk:min-h-6"

/**
 * The shape every pre-auth screen takes: the charcoal product panel on the
 * left and a white column holding one 400px card on the right. The card
 * column is the page's `<main>` and carries its only `h1`; the `(auth)`
 * layout renders no landmark of its own.
 *
 * Phone first: below `lg` the card is top-aligned so the form starts in the
 * thumb's reach and an on-screen keyboard never hides the heading. The main
 * clears the notch and home indicator (`pt-safe`/`px-safe`) and, while the
 * iOS keyboard is open, pads its foot by the keyboard's height (`pb-dock`)
 * so the submit button can still be scrolled into view above it.
 */
function AuthCard({
  eyebrow,
  title,
  description,
  mark,
  children,
  footer,
  aside = "product",
  titleRef,
}: {
  eyebrow?: React.ReactNode
  title: string
  description?: React.ReactNode
  /** A 44px tinted glyph above the eyebrow (e.g. the mail mark). */
  mark?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  aside?: AsideVariant
  titleRef?: React.Ref<HTMLHeadingElement>
}) {
  return (
    <>
      <a href="#main" className={SKIP_LINK_CLASS}>
        Skip to content
      </a>
      <AuthAside variant={aside} />
      <main
        id="main"
        tabIndex={-1}
        className="flex min-w-0 flex-col bg-surface pt-safe px-safe pb-dock outline-none"
      >
        <div className="mx-auto flex w-full max-w-100 flex-1 flex-col gap-6 px-4 pt-6 pb-10 sm:gap-8 sm:px-0 sm:pt-12 sm:pb-12 lg:justify-center lg:py-16">
          <Link
            href="/sign-in"
            className={cn(
              TOUCH_LINK_CLASS,
              "w-fit rounded-md focus-halo focus-visible:outline-none lg:hidden"
            )}
          >
            <BrandMark size="lg" />
          </Link>

          <header className="flex flex-col gap-2">
            {mark ? (
              <span
                aria-hidden
                className="mb-1 grid size-11 place-items-center rounded-lg bg-accent-tint text-accent-ink [&_svg]:size-5"
              >
                {mark}
              </span>
            ) : null}
            {eyebrow ? <p className={EYEBROW_CLASS}>{eyebrow}</p> : null}
            <h1
              ref={titleRef}
              tabIndex={-1}
              className="font-display text-page-title font-semibold text-balance text-ink outline-none"
            >
              {title}
            </h1>
            {description ? (
              <p className="text-body text-pretty text-ink-muted">
                {description}
              </p>
            ) : null}
          </header>

          <div className="flex flex-col gap-6">{children}</div>

          {footer ? (
            <footer className="flex flex-col items-center gap-2 text-center text-ui text-ink-muted">
              {footer}
            </footer>
          ) : null}

          {/* `/` lands here, so this is the public home page Google's OAuth
              review checks for a privacy policy link. */}
          <nav
            aria-label="Legal"
            className="flex flex-wrap justify-center gap-x-4 text-caption text-ink-muted"
          >
            <Link
              href="/privacy"
              className={cn(
                TOUCH_LINK_CLASS,
                "rounded-sm underline-offset-4 focus-halo hover:underline focus-visible:outline-none"
              )}
            >
              Privacy policy
            </Link>
            <Link
              href="/terms"
              className={cn(
                TOUCH_LINK_CLASS,
                "rounded-sm underline-offset-4 focus-halo hover:underline focus-visible:outline-none"
              )}
            >
              Terms of service
            </Link>
          </nav>
        </div>
      </main>
    </>
  )
}

export { AuthCard, type AsideVariant }
