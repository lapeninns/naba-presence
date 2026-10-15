import { Check, Flag, Minus } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Where a step is. `skipped` is a step this run does not need (verification
 * that went straight to the outcome without a PIN); it is drawn like a to-do
 * in the ring stepper and says "Not needed" in the quiet one.
 */
export type StepState = "done" | "current" | "todo" | "skipped"

export type Step = {
  id: string
  label: string
  state: StepState
  /** One short line: who, when, or why this step is where it is. */
  meta?: string
  /** Makes the step a link (a wizard step the operator may revisit). */
  href?: string
  /** A trailing note such as "Optional". */
  note?: string
  /**
   * `variant="quiet"`: this step's state word, replacing the stepper's
   * `stateWords` for this one step ("Sent", "Code entered").
   */
  stateLabel?: string
  /**
   * A closing step that is not one of the numbered ones ("Done"): its ring
   * draws a flag instead of a number, and it does not use up a number, so
   * the list agrees with a "Step N of M" counter that leaves it out.
   */
  unnumbered?: boolean
}

/** The quiet stepper's default state words. */
export const STEP_STATE_WORDS: Record<StepState, string> = {
  done: "Done",
  current: "Current",
  todo: "To do",
  skipped: "Not needed",
}

/**
 * Progress through an ordered flow (reference `.stepper`).
 *
 * Each step has a 22px number ring (tabular figures): done is the ok tint with a tick,
 * current is the accent solid (and, vertically, the whole row sits on the
 * accent tint), to-do is the control edge. `ol` with `aria-current="step"`
 * on the active item is the accessible contract; the rings and rules are
 * decorative, and every state is also in words (label, meta, note).
 *
 * `vertical` is the setup rail; `horizontal` a compact row that scrolls
 * sideways inside itself when it does not fit. For a reply's five-stage
 * record use `Lifecycle` instead.
 *
 * On a phone (below 48rem) a horizontal stepper keeps every ring but only
 * the CURRENT step's words: four labels side by side at 360px each
 * truncated to "Con…", which said less than the numbers. The other labels
 * stay in the accessibility tree, so the list still reads in full.
 *
 * `variant="quiet"` is a calm vertical sequence for a short flow inside a
 * page (verification: start → PIN → outcome). No rings, no tinted row:
 * each step is a small reinforcing mark (a tick, a dot, a ring, a dash),
 * the label (wraps, never truncated), its meta line, and the state in
 * words on the trailing edge ("Done", "Current", "To do", "Not needed").
 * The word leads; the mark and the weight only reinforce it. Override the
 * words for the whole list with `stateWords`, or for one step with
 * `stateLabel`. It is always vertical (`orientation` is ignored), and the
 * current step carries `aria-current="step"` as in the ring stepper.
 */
function Stepper({
  steps,
  orientation = "horizontal",
  variant = "default",
  stateWords,
  className,
  ...props
}: Omit<React.ComponentProps<"ol">, "children"> & {
  steps: Step[]
  orientation?: "horizontal" | "vertical"
  /** `quiet`: the words-first vertical list (see above). */
  variant?: "default" | "quiet"
  /** `variant="quiet"`: replaces some or all of `STEP_STATE_WORDS`. */
  stateWords?: Partial<Record<StepState, string>>
}) {
  if (variant === "quiet") {
    return (
      <QuietStepper
        steps={steps}
        stateWords={stateWords}
        className={className}
        {...props}
      />
    )
  }
  const vertical = orientation === "vertical"
  // An unnumbered step does not use up a number.
  let counted = 0
  const numbers = steps.map((step) => (step.unnumbered ? 0 : ++counted))
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
              "grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] text-count leading-none tabular-nums",
              step.state === "done" &&
                "border-success-ink bg-success-tint text-success-ink",
              step.state === "current" &&
                "border-primary bg-primary text-primary-foreground",
              step.state === "todo" && "border-line-strong text-ink-muted",
              step.state === "skipped" && "border-line text-ink-muted"
            )}
          >
            {step.state === "done" ? (
              <Check className="size-3" strokeWidth={2.5} />
            ) : step.unnumbered ? (
              <Flag className="size-3" strokeWidth={2.5} />
            ) : (
              numbers[index]
            )}
          </span>
        )
        const body = (
          <>
            {ring}
            <span
              className={cn(
                "flex min-w-0 flex-col",
                !vertical && step.state !== "current" && "max-md:sr-only"
              )}
            >
              <span className="truncate">{step.label}</span>
              {step.meta ? (
                <span className="truncate text-caption font-normal text-ink-muted">
                  {step.meta}
                </span>
              ) : null}
            </span>
            {step.note ? (
              <span
                className={cn(
                  "ml-auto shrink-0",
                  !vertical && step.state !== "current" && "max-md:sr-only",
                  "text-caption font-normal text-ink-muted"
                )}
              >
                {step.note}
              </span>
            ) : null}
          </>
        )
        const rowClass = cn(
          "flex min-w-0 items-center gap-2.5 rounded-(--np-radius-control) px-2.5 py-2 text-ui text-ink-secondary no-underline",
          step.state === "current" && "font-semibold",
          // Ring-only steps on a phone need no side padding of their own.
          !vertical && step.state !== "current" && "max-md:px-1",
          vertical &&
            step.state === "current" &&
            "bg-accent-tint text-accent-ink",
          step.href &&
            "min-h-(--np-touch) focus-halo transition-colors duration-(--np-duration-fast) hover:bg-fill desk:min-h-0",
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
              // A step takes its own width and only the rules between steps
              // grow: equal shares truncated "Connect Google" at the desk and
              // left the current step ~40px for its words on a phone. When
              // the row cannot fit, it scrolls rather than clipping words.
              !vertical && !isLast && "flex-[1_0_auto]"
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
                  "mx-1 h-0.5 min-w-4 flex-1 rounded-full max-md:min-w-2",
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

const QUIET_MARK: Record<StepState, React.ReactNode> = {
  done: <Check className="size-4 text-success-ink" strokeWidth={2.25} />,
  current: <span className="size-2 rounded-full bg-primary" />,
  todo: (
    <span className="size-2 rounded-full border-[1.5px] border-line-strong" />
  ),
  skipped: <Minus className="size-4 text-ink-muted" strokeWidth={2} />,
}

const QUIET_WORD_TONE: Record<StepState, string> = {
  done: "text-success-ink",
  current: "font-medium text-accent-ink",
  todo: "text-ink-muted",
  skipped: "text-ink-muted",
}

const QUIET_LABEL_TONE: Record<StepState, string> = {
  done: "text-ink-secondary",
  current: "font-medium text-ink",
  todo: "text-ink-secondary",
  skipped: "text-ink-muted",
}

function QuietStepper({
  steps,
  stateWords,
  className,
  ...props
}: Omit<React.ComponentProps<"ol">, "children"> & {
  steps: Step[]
  stateWords?: Partial<Record<StepState, string>>
}) {
  const words = { ...STEP_STATE_WORDS, ...stateWords }
  return (
    <ol
      data-slot="stepper"
      data-orientation="vertical"
      data-variant="quiet"
      className={cn("flex list-none flex-col", className)}
      {...props}
    >
      {steps.map((step) => {
        const body = (
          <>
            <span
              aria-hidden
              data-slot="stepper-mark"
              className="grid size-5 shrink-0 place-items-center"
            >
              {QUIET_MARK[step.state]}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  "text-ui break-words",
                  QUIET_LABEL_TONE[step.state]
                )}
              >
                {step.label}
              </span>
              {step.meta ? (
                <span className="text-caption break-words text-ink-muted">
                  {step.meta}
                </span>
              ) : null}
            </span>
            <span
              data-slot="stepper-state"
              className={cn(
                "shrink-0 text-caption",
                QUIET_WORD_TONE[step.state]
              )}
            >
              {step.stateLabel ?? words[step.state]}
              {step.note ? (
                <span className="text-ink-muted"> · {step.note}</span>
              ) : null}
            </span>
          </>
        )
        const rowClass = cn(
          "flex min-w-0 items-start gap-3 rounded-(--np-radius-control) px-1 py-2 no-underline",
          step.href &&
            "min-h-(--np-touch) focus-halo transition-colors duration-(--np-duration-fast) hover:bg-fill desk:min-h-0"
        )
        return (
          <li
            key={step.id}
            data-state={step.state}
            aria-current={step.state === "current" ? "step" : undefined}
            className="min-w-0"
          >
            {step.href ? (
              <Link href={step.href} className={rowClass}>
                {body}
              </Link>
            ) : (
              <span className={rowClass}>{body}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export { Stepper }
