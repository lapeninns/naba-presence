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
    statement: "Your clients’ Google reviews and listings, run from one desk.",
    beats: [
      {
        icon: Inbox,
        title: "Every client’s reviews in one inbox",
        text: "Needs reply, approval and failed publishes, across every pub and restaurant you look after.",
      },
      {
        icon: ShieldCheck,
        title: "Approve replies before they go live",
        text: "Drafts are checked against your reply policy, and a reply can need a second person’s approval.",
      },
      {
        icon: Send,
        title: "Publish to each client’s Business Profile",
        text: "Changes go out through each client’s own Google connection and show as live only once Google confirms.",
      },
    ],
    footnote:
      "For agencies that manage Google Business Profiles for hospitality clients.",
  },
  recovery: {
    label: "About account recovery",
    statement: "Resetting your password changes only your sign-in.",
    beats: [
      {
        icon: Link2,
        text: "Every client’s Google connection keeps working. Nothing is disconnected or re-authorised.",
      },
      {
        icon: PencilLine,
        text: "Drafts and approvals stay where you left them.",
      },
    ],
    footnote:
      "Locked out of a client’s Google login instead? An owner or admin can reconnect it from Settings.",
  },
  reset: {
    label: "About account recovery",
    statement: "A new password for you. Nothing changes for your clients.",
    beats: [
      {
        icon: Link2,
        text: "Every client’s Google connection keeps working. Nothing is disconnected or re-authorised.",
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
    statement: "Your agency has asked you to help with its clients.",
    beats: [
      {
        icon: Inbox,
        title: "Every client’s reviews in one inbox",
        text: "You see the clients your role and access allow.",
      },
      {
        icon: ShieldCheck,
        title: "Approve replies before they go live",
        text: "Your role decides whether you draft, approve or publish.",
      },
      {
        icon: Send,
        title: "Publish to each client’s Business Profile",
        text: "Through the Google logins your agency has already connected. You don’t connect your own.",
      },
    ],
    footnote:
      "Invitations are sent by an agency owner or admin and work for one email address.",
  },
}

/**
 * The charcoal half of the split layout. Hidden at 900px and below, where the
 * compact wordmark above the card takes its place.
 */
function AuthAside({ variant }: { variant: AsideVariant }) {
  const aside = ASIDES[variant]
  return (
    <aside
      aria-label={aside.label}
      className="hidden flex-col justify-between gap-8 bg-charcoal p-[clamp(28px,5vw,64px)] text-ink-on-charcoal min-[901px]:flex"
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
        <p className="max-w-[20ch] font-display text-display font-semibold text-balance">
          {aside.statement}
        </p>
        <ul className="flex max-w-[44ch] flex-col gap-5">
          {aside.beats.map((beat) => (
            <li
              key={beat.text}
              className="grid grid-cols-[34px_minmax(0,1fr)] items-start gap-3.5"
            >
              <span
                aria-hidden
                className="grid size-[34px] place-items-center rounded-[9px] shadow-[inset_0_0_0_1px_var(--np-ink-muted-on-charcoal)]"
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
 * The shape every pre-auth screen takes: the charcoal product panel on the
 * left and a white column holding one 400px card on the right. The card
 * column is the page's `<main>` and carries its only `h1`; the `(auth)`
 * layout renders no landmark of its own.
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
      <AuthAside variant={aside} />
      <main
        id="main"
        tabIndex={-1}
        className="flex min-w-0 flex-col justify-center bg-surface p-[clamp(24px,5vw,56px)] outline-none max-[901px]:justify-start max-[901px]:pt-10 max-[431px]:px-4 max-[431px]:pt-5 max-[431px]:pb-9"
      >
        <div className="mx-auto flex w-full max-w-[400px] flex-col gap-5 max-[431px]:gap-4">
          <Link
            href="/sign-in"
            className="w-fit rounded-md focus-halo focus-visible:outline-none min-[901px]:hidden"
          >
            <BrandMark size="lg" />
          </Link>

          <header className="flex flex-col gap-1.5">
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

          <div className="flex flex-col gap-5">{children}</div>

          {footer ? (
            <footer className="flex flex-col items-center gap-1.5 text-center text-ui text-ink-muted">
              {footer}
            </footer>
          ) : null}
        </div>
      </main>
    </>
  )
}

export { AuthCard, type AsideVariant }
