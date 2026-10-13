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
 * Drawing (reference `.empty`): a 44px rounded mark holding the glyph, a
 * title, one muted sentence and the actions, centred. The title is a `p`
 * unless `titleAs` asks for a heading, so an empty state never disturbs the
 * page outline by accident. Pass `role="alert"` (or `"status"`) only when
 * the state replaces content because something just happened; QueryStates
 * does that for its error state.
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
  titleAs: Title = "p",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  /** The next step. One primary action; a second is at most secondary. */
  action?: React.ReactNode
  /** A lucide glyph, drawn at 20px inside the mark. `null` for none. */
  icon?: React.ReactNode
  variant?: EmptyVariant
  /** Overrides the variant's colour. `ok` is the all-clear. */
  tone?: EmptyTone
  /** Draw the card box around the state. */
  framed?: boolean
  /** `sm`: less padding, for a panel or a list section. */
  size?: "default" | "sm"
  titleAs?: "p" | "h2" | "h3"
}) {
  const defaults = VARIANT_DEFAULTS[variant]
  const resolvedTone = tone ?? defaults.tone
  const glyph = icon === undefined ? defaults.icon : icon
  return (
    <div
      data-slot="empty"
      data-variant={variant}
      data-tone={resolvedTone}
      className={cn(
        "flex flex-col items-center justify-center gap-2.5 px-5 text-center",
        size === "sm" ? "py-6" : "py-8 sm:py-12 lg:py-16",
        framed &&
          "rounded-(--np-radius-card) border border-line bg-surface",
        className
      )}
      {...props}
    >
      {glyph ? (
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
      <Title className="text-title font-semibold text-balance text-ink">
        {title}
      </Title>
      {description ? (
        <div className="max-w-sm text-ui text-pretty text-ink-muted">
          {description}
        </div>
      ) : null}
      {action ? (
        <div className="mt-1.5 flex flex-wrap justify-center gap-2">
          {action}
        </div>
      ) : null}
    </div>
  )
}

export { Empty }
