import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Reference `.card`: a white surface drawn with a 1px hairline, radius 12,
 * 20px inside (16px for `size="sm"`). No shadow, no tint.
 *
 * `inset` makes a card whose direct children are rows: the padding and gap
 * collapse and the rows are divided by hairlines. `flush` removes padding
 * entirely (reference `.card-flush`) for a table or media inside.
 *
 * `CardHeader divided` draws the reference `.card-head` (a bottom rule);
 * `CardFooter bar` draws `.card-foot` (top rule on the sunken surface).
 */
function Card({
  className,
  size = "default",
  inset = false,
  flush = false,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm"
  inset?: boolean
  flush?: boolean
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-inset={inset || undefined}
      data-flush={flush || undefined}
      className={cn(
        "group/card flex min-w-0 flex-col gap-(--card-spacing) overflow-hidden rounded-(--np-radius-card) border border-line bg-surface py-(--card-spacing) text-body text-ink [--card-spacing:var(--np-card-pad)] [--card-pt:var(--card-spacing)] data-[flush]:[--card-pt:0px] data-[inset]:[--card-pt:0px] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(4)] data-[inset]:gap-0 data-[inset]:divide-y data-[inset]:divide-line data-[inset]:py-0 data-[flush]:gap-0 data-[flush]:py-0 *:[img:first-child]:rounded-t-(--np-radius-card) *:[img:last-child]:rounded-b-(--np-radius-card)",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({
  className,
  divided = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** Reference `.card-head`: 16/20 padding and a hairline beneath. */
  divided?: boolean
}) {
  return (
    <div
      data-slot="card-header"
      data-divided={divided || undefined}
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-0.5 px-(--card-spacing) group-data-[inset]/card:py-(--card-spacing) has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] has-data-[slot=card-action]:gap-x-3 has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:border-line [.border-b]:pb-(--card-spacing)",
        divided &&
          "-mt-(--card-pt) border-b border-line py-4",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({
  as: Heading = "h3",
  className,
  ...props
}: React.ComponentProps<"h3"> & { as?: "h1" | "h2" | "h3" | "h4" }) {
  return (
    <Heading
      data-slot="card-title"
      className={cn("text-title font-semibold text-balance text-ink", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-ui text-ink-muted", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({
  className,
  bar = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** Reference `.card-foot`: a top rule on the sunken surface, 12/20 padding. */
  bar?: boolean
}) {
  return (
    <div
      data-slot="card-footer"
      data-bar={bar || undefined}
      className={cn(
        "flex flex-wrap items-center gap-3 px-(--card-spacing) group-data-[inset]/card:py-(--card-spacing) [.border-t]:border-line [.border-t]:pt-(--card-spacing)",
        bar &&
          "mt-auto -mb-(--card-pt) justify-between border-t border-line bg-surface-alt py-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
