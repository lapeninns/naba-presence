import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The dark action bar (reference `.actionbar`): the one charcoal
 * counter-surface per screen, holding the action that reaches Google
 * (editor footer, inbox composer footer, bulk bar).
 *
 * Props
 *   status    what is true right now, in words ("2 changes not on Google ·
 *             Saved here 4 min ago"); wrap secondary words in
 *             `<ActionBarMuted>`. Announced politely when it changes.
 *   actions   the buttons. Use `variant="ghost-dark"` / `"on-dark"` for the
 *             quiet ones and the default (accent) variant for the one
 *             primary; plain `ghost`/`secondary` are restyled by the
 *             `on-charcoal` utility.
 *   sticky    pin to the bottom of the scroll container (default true).
 *   offset    distance from the bottom when sticky ("bottom-3").
 *   safeArea  add the phone's bottom safe-area inset to the padding (default
 *             true; turn off when the bar sits inside a card).
 *   label     names the region (default "Actions").
 *
 * It never covers content by itself: the CALLER reserves space for it (a
 * bottom padding on the scroll container at least as tall as the bar), so
 * the last field is never hidden behind it. In the dark theme charcoal is
 * near-white with dark ink — always read the role utilities.
 */
function ActionBar({
  status,
  actions,
  sticky = true,
  offset = "bottom-0",
  safeArea = true,
  label = "Actions",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  status?: React.ReactNode
  actions?: React.ReactNode
  sticky?: boolean
  offset?: string
  safeArea?: boolean
  label?: string
  children?: React.ReactNode
}) {
  return (
    <div
      role="region"
      aria-label={label}
      data-slot="action-bar"
      className={cn(
        "z-20 flex flex-wrap items-center gap-3 rounded-(--np-radius-card) on-charcoal px-4 py-3 shadow-np-pop",
        sticky && cn("sticky", offset),
        safeArea && "pb-[max(12px,env(safe-area-inset-bottom))]",
        "[&_:focus-visible]:outline-ink-on-charcoal",
        className
      )}
      {...props}
    >
      {status !== undefined ? (
        <div
          data-slot="action-bar-status"
          aria-live="polite"
          className="flex min-w-0 flex-[1_1_240px] items-center gap-2.5 text-ui [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:[stroke-width:1.75]"
        >
          {status}
        </div>
      ) : null}
      {children}
      {actions !== undefined ? (
        <div
          data-slot="action-bar-actions"
          className="ml-auto flex flex-wrap items-center justify-end gap-2"
        >
          {actions}
        </div>
      ) : null}
    </div>
  )
}

/** Secondary words in the status slot, in the muted on-charcoal ink. */
function ActionBarMuted({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("text-ink-muted-on-charcoal", className)} {...props} />
  )
}

export { ActionBar, ActionBarMuted }
