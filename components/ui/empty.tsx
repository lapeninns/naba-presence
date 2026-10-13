import {
  CircleAlertIcon,
  LockIcon,
  PowerOffIcon,
  WifiOffIcon,
} from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Why there is nothing to show. One vocabulary for every list, panel and
 * page that comes up empty (prim-14):
 *
 *   empty        nothing here yet, or nothing matches ("No reviews match").
 *   error        it failed to load: name the cause and offer a retry. A
 *                failed load is never drawn as plain `empty` — that would
 *                hide a real error behind "nothing here".
 *   forbidden    this person's role cannot see it; say who can.
 *   offline      the device lost its connection; say it will retry.
 *   not-enabled  the feature is off for this listing or workspace (a
 *                capability, a plan); say how it is switched on.
 *
 * Each variant brings its own glyph and tone; `icon` replaces the glyph,
 * `tone` (the original API: neutral / ok for an all-clear / bad) still
 * overrides the colour. `framed` draws the card box (surface, hairline,
 * card radius) for a state that stands alone in a page; plain is for a
 * state that sits inside a card or panel already. `size="sm"` is the
 * compact drawing for a panel or a list section.
 *
 * Drawing (reference `.empty`, NM "All caught up!"): a 44px rounded mark
 * holding the glyph, or, in its place, an `illustration` (a 112px line
 * drawing in the ink at a 1.5 stroke, `EmptyIllustration`); a title in
 * `text-title` 500; one `text-caption` muted sentence that says why it is
 * empty and what happens next; at most one action; centred.
 * `placement="page"` is for a state that IS the page (inbox zero, a search
 * with no results): it fills the space and sits at about 35% of its height,
 * not dead centre. The title is a `p`
 * unless `titleAs` asks for a heading, so an empty state never disturbs the
 * page outline by accident. `titleAs="h1"` is only for a state that IS the
 * page (PageEmptyState): its title is then the page's one h1. Pass
 * `role="alert"` (or `"status"`) only when the state replaces content
 * because something just happened; QueryStates does that for its error
 * state.
 *
 * `actions` is the way to offer "Try again" on an announced error. With
 * `actions` set, the live-region props (`role`, `aria-live`, `aria-atomic`,
 * `aria-relevant`) go on an inner `empty-message` wrapper around the mark,
 * title and description, and the actions (`action` first, then `actions`)
 * sit after it, outside the announced region: the alert reads what
 * happened, not the button labels. Every other prop stays on the outer
 * `data-slot="empty"` element, which keeps the layout.
 */
export type EmptyVariant =
  "empty" | "error" | "forbidden" | "offline" | "not-enabled"

type EmptyTone = "neutral" | "ok" | "bad" | "warn"

const VARIANT_DEFAULTS: Record<
  EmptyVariant,
  { tone: EmptyTone; icon: React.ReactNode }
> = {
  empty: { tone: "neutral", icon: null },
  error: { tone: "bad", icon: <CircleAlertIcon /> },
  forbidden: { tone: "neutral", icon: <LockIcon /> },
  offline: { tone: "warn", icon: <WifiOffIcon /> },
  "not-enabled": { tone: "neutral", icon: <PowerOffIcon /> },
}

const MARK_TONE: Record<EmptyTone, string> = {
  neutral: "bg-fill text-ink-secondary",
  ok: "bg-success-tint text-success-ink",
  bad: "bg-danger-tint text-danger-ink",
  warn: "bg-warning-tint text-warning-ink",
}

function Empty({
  title,
  description,
  action,
  icon,
  variant = "empty",
  tone,
  framed = false,
  size = "default",
  illustration,
  placement = "inline",
  titleAs: Title = "p",
  actions,
  className,
  children,
  role,
  "aria-live": ariaLive,
  "aria-atomic": ariaAtomic,
  "aria-relevant": ariaRelevant,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  /** The next step. One primary action; a second is at most secondary. */
  action?: React.ReactNode
  /**
   * Actions drawn OUTSIDE the announced region (see above): for an error
   * with `role="alert"`, "Try again" and the way out go here so the alert
   * announces only what happened. With `action` too, `action` leads.
   */
  actions?: React.ReactNode
  /** A lucide glyph, drawn at 20px inside the mark. `null` for none. */
  icon?: React.ReactNode
  variant?: EmptyVariant
  /** Overrides the variant's colour. `ok` is the all-clear. */
  tone?: EmptyTone
  /** Draw the card box around the state. */
  framed?: boolean
  /** `sm`: less padding, for a panel or a list section. */
  size?: "default" | "sm"
  /** `h1` only when this state is the whole page (see above). */
  titleAs?: "p" | "h1" | "h2" | "h3" | "h4"
  /**
   * A line drawing in place of the glyph mark (`<EmptyIllustration
   * name="inbox-zero" />`, or any SVG drawn with `currentColor`). Decorative:
   * hidden from assistive tech, the title carries the meaning.
   */
  illustration?: React.ReactNode
  /** `page`: the state fills the page, centred at about 35% of the height. */
  placement?: "inline" | "page"
}) {
  const defaults = VARIANT_DEFAULTS[variant]
  const resolvedTone = tone ?? defaults.tone
  const glyph = icon === undefined ? defaults.icon : icon
  const message = (
    <>
      {illustration ? (
        <span
          aria-hidden
          data-slot="empty-illustration"
          className="mb-2 grid size-28 place-items-center text-ink [&_svg]:size-full"
        >
          {illustration}
        </span>
      ) : glyph ? (
        <span
          aria-hidden
          className={cn(
            "grid size-11 place-items-center rounded-(--np-radius-card) [&_svg]:size-5 [&_svg]:[stroke-width:1.75]",
            MARK_TONE[resolvedTone]
          )}
        >
          {glyph}
        </span>
      ) : null}
      {children}
      <Title className="text-title font-medium text-balance text-ink">
        {title}
      </Title>
      {description ? (
        <div className="max-w-sm text-caption text-pretty text-ink-muted">
          {description}
        </div>
      ) : null}
    </>
  )
  const actionRow = action ? (
    <div className="mt-1.5 flex flex-wrap justify-center gap-2">{action}</div>
  ) : null
  return (
    <div
      data-slot="empty"
      data-variant={variant}
      data-tone={resolvedTone}
      data-placement={placement}
      className={cn(
        "flex flex-col items-center justify-center gap-2.5 px-5 text-center",
        size === "sm" ? "py-6" : "py-8 sm:py-12 lg:py-16",
        // Two weighted spacers (35 : 65) put the content's centre at about
        // 35% of the page's height rather than its middle.
        placement === "page" &&
          "min-h-[60dvh] flex-1 justify-start before:grow-35 before:content-[''] after:grow-65 after:content-['']",
        framed && "rounded-(--np-radius-card) border border-line bg-surface",
        className
      )}
      {...(actions
        ? null
        : {
            role,
            "aria-live": ariaLive,
            "aria-atomic": ariaAtomic,
            "aria-relevant": ariaRelevant,
          })}
      {...props}
    >
      {actions ? (
        <>
          <div
            data-slot="empty-message"
            role={role}
            aria-live={ariaLive}
            aria-atomic={ariaAtomic}
            aria-relevant={ariaRelevant}
            className="flex flex-col items-center gap-2.5"
          >
            {message}
          </div>
          <div
            data-slot="empty-actions"
            className="mt-1.5 flex flex-wrap justify-center gap-2"
          >
            {action}
            {actions}
          </div>
        </>
      ) : (
        <>
          {message}
          {actionRow}
        </>
      )}
    </div>
  )
}

export type EmptyIllustrationName = "inbox-zero" | "search"

/**
 * The line drawings an empty state can carry. Strokes only, in
 * `currentColor` (the ink), 1.5 wide at any drawn size; no fills, no
 * literal colours, so they follow the theme.
 */
function EmptyIllustration({
  name,
  className,
  ...props
}: Omit<React.ComponentProps<"svg">, "children"> & {
  name: EmptyIllustrationName
}) {
  return (
    <svg
      data-slot="empty-illustration-svg"
      data-name={name}
      viewBox="0 0 112 112"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={cn("size-28", className)}
      {...props}
    >
      {name === "inbox-zero" ? <InboxZeroDrawing /> : <SearchDrawing />}
    </svg>
  )
}

/** An open tray with a tick resting in it and two small sparks: all clear. */
function InboxZeroDrawing() {
  return (
    <g>
      <path
        vectorEffect="non-scaling-stroke"
        d="M22 62 L32 36 H80 L90 62 V82 A6 6 0 0 1 84 88 H28 A6 6 0 0 1 22 82 Z"
      />
      <path
        vectorEffect="non-scaling-stroke"
        d="M22 62 H42 A14 8 0 0 0 70 62 H90"
      />
      <path vectorEffect="non-scaling-stroke" d="M46 50 L53 57 L67 43" />
      <path vectorEffect="non-scaling-stroke" d="M86 18 V26 M82 22 H90" />
      <path vectorEffect="non-scaling-stroke" d="M24 20 V26 M21 23 H27" />
      <path vectorEffect="non-scaling-stroke" d="M96 38 V42 M94 40 H98" />
    </g>
  )
}

/** A magnifier over three faint result lines: nothing matched. */
function SearchDrawing() {
  return (
    <g>
      <path vectorEffect="non-scaling-stroke" d="M18 30 H62" />
      <path vectorEffect="non-scaling-stroke" d="M18 44 H48" />
      <path vectorEffect="non-scaling-stroke" d="M18 58 H40" />
      <circle vectorEffect="non-scaling-stroke" cx="66" cy="62" r="20" />
      <path vectorEffect="non-scaling-stroke" d="M80 76 L94 90" />
      <path vectorEffect="non-scaling-stroke" d="M59 62 H73" />
    </g>
  )
}

export { Empty, EmptyIllustration }
