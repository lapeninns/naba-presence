import { Check } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { cn } from "@/lib/utils"

export type Step = {
  id: string
  label: string
  state: "done" | "current" | "todo"
  /** One short line: who, when, or why this step is where it is. */
  meta?: string
  /** Makes the step a link (a wizard step the operator may revisit). */
  href?: string
  /** A trailing note such as "Optional". */
  note?: string
}

/**
 * Progress through an ordered flow (reference `.stepper`).
 *
 * Each step has a 22px mono number ring: done is the ok tint with a tick,
 * current is the accent solid (and, vertically, the whole row sits on the
 * accent tint), to-do is the control edge. `ol` with `aria-current="step"`
 * on the active item is the accessible contract; the rings and rules are
 * decorative, and every state is also in words (label, meta, note).
 *
 * `vertical` is the setup rail; `horizontal` a compact row that scrolls
 * sideways inside itself when it does not fit. For a reply's five-stage
 * record use `Lifecycle` instead.
 */
function Stepper({
  steps,
  orientation = "horizontal",
  className,
  ...props
}: Omit<React.ComponentProps<"ol">, "children"> & {
  steps: Step[]
  orientation?: "horizontal" | "vertical"
}) {
  const vertical = orientation === "vertical"
  return (
    <ol
      data-slot="stepper"
      data-orientation={orientation}
      className={cn(
        "list-none",
        vertical
          ? "flex flex-col gap-0.5"
          : "flex [scrollbar-width:none] items-center gap-0 overflow-x-auto",
        className
      )}
      {...props}
    >
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1
        const ring = (
          <span
            aria-hidden
            className={cn(
              "grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] font-mono text-[11px] tabular-nums",
              step.state === "done" &&
                "border-success-ink bg-success-tint text-success-ink",
              step.state === "current" &&
                "border-primary bg-primary text-primary-foreground",
              step.state === "todo" && "border-line-strong text-ink-muted"
            )}
          >
            {step.state === "done" ? (
              <Check className="size-3" strokeWidth={2.5} />
            ) : (
              index + 1
            )}
          </span>
        )
        const body = (
          <>
            {ring}
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{step.label}</span>
              {step.meta ? (
                <span className="truncate text-caption font-normal text-ink-muted">
                  {step.meta}
                </span>
              ) : null}
            </span>
            {step.note ? (
              <span className="ml-auto shrink-0 text-[11.5px] font-normal text-ink-muted">
                {step.note}
              </span>
            ) : null}
          </>
        )
        const rowClass = cn(
          "flex min-w-0 items-center gap-2.5 rounded-(--np-radius-control) px-2.5 py-2 text-ui text-ink-secondary no-underline",
          step.state === "current" && "font-semibold",
          vertical &&
            step.state === "current" &&
            "bg-accent-tint text-accent-ink",
          step.href &&
            "focus-halo transition-colors duration-(--np-duration-fast) hover:bg-fill",
          step.href &&
            vertical &&
            step.state === "current" &&
            "hover:bg-accent-tint"
        )
        return (
          <li
            key={step.id}
            data-state={step.state}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn(
              "min-w-0",
              !vertical && "flex shrink-0 items-center",
              !vertical && !isLast && "flex-1"
            )}
          >
            {step.href ? (
              <Link href={step.href} className={rowClass}>
                {body}
              </Link>
            ) : (
              <span className={rowClass}>{body}</span>
            )}
            {!vertical && !isLast ? (
              <span
                aria-hidden
                className={cn(
                  "mx-1 h-0.5 min-w-4 flex-1 rounded-full",
                  step.state === "done" ? "bg-success-solid" : "bg-line"
                )}
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export { Stepper }
