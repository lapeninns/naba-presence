import { Check, X } from "lucide-react"

import type { LifecycleStep } from "@/lib/inbox/lifecycle"
import { lifecycleSummary } from "@/lib/inbox/lifecycle"
import { cn } from "@/lib/utils"

/**
 * Received → Drafted → Verified → Approved → Published, with who and when.
 *
 * An `ol` because the order is the meaning, with `aria-current="step"` on the
 * live one. Every state is also written out in the step's own meta line, so
 * the colours and the tick are decoration rather than the only signal.
 */
function LifecycleStrip({ steps }: { steps: LifecycleStep[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <ol
        aria-label="Reply progress"
        className="flex items-start gap-0 overflow-x-auto"
      >
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1
          return (
            <li
              key={step.id}
              aria-current={step.state === "current" ? "step" : undefined}
              className="flex min-w-0 flex-1 flex-col gap-1.5"
            >
              <div className="flex items-center">
                <Marker state={step.state} />
                {isLast ? null : (
                  <span
                    aria-hidden
                    className={cn(
                      "mx-1.5 h-0.5 flex-1",
                      step.state === "done" ? "bg-[var(--np-accent)]" : "bg-line"
                    )}
                  />
                )}
              </div>
              <div className="min-w-0 pr-2">
                <p
                  className={cn(
                    "truncate text-caption font-medium",
                    step.state === "todo" || step.state === "skipped"
                      ? "text-ink-muted"
                      : "text-ink"
                  )}
                >
                  {step.label}
                </p>
                {step.meta ? (
                  <p className="truncate text-caption text-ink-muted" title={step.meta}>
                    {step.meta}
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
      {/* The same story in one sentence: the strip scrolls horizontally on a
          phone, and a screen reader should not have to walk five list items to
          learn where the reply is. */}
      <p className="sr-only">{lifecycleSummary(steps)}</p>
    </div>
  )
}

function Marker({ state }: { state: LifecycleStep["state"] }) {
  const base =
    "flex size-5 shrink-0 items-center justify-center rounded-full text-caption"
  if (state === "done") {
    return (
      <span aria-hidden className={cn(base, "bg-primary text-primary-foreground")}>
        <Check className="size-3" />
      </span>
    )
  }
  if (state === "failed") {
    return (
      <span
        aria-hidden
        className={cn(base, "bg-[var(--np-danger-solid)] text-[var(--np-danger-on-solid)]")}
      >
        <X className="size-3" />
      </span>
    )
  }
  if (state === "current") {
    return (
      <span
        aria-hidden
        className={cn(base, "border-2 border-[var(--np-warning-ink)] bg-warning-tint")}
      />
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        base,
        "border border-[var(--np-line-strong)]",
        state === "skipped" && "border-dashed"
      )}
    />
  )
}

export { LifecycleStrip }
