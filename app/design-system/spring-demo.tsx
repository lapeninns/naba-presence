"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

/**
 * The two spring curves beside the standard curve, driven by the same
 * tokens the product uses. A client component because the demo needs a
 * click to replay and a switch to slow it down; the curves themselves are
 * read from CSS, so a retuned `linear()` in globals.css shows up here.
 */
const CURVES = [
  {
    id: "spring",
    label: "Spring",
    token: "--np-ease-spring",
    note: "Overlays entering, switch thumbs, the tab indicator. One gentle overshoot, then it settles.",
  },
  {
    id: "spring-snappy",
    label: "Spring, snappy",
    token: "--np-ease-spring-snappy",
    note: "Hover, press and the segmented thumb. Quick, with almost no overshoot.",
  },
  {
    id: "standard",
    label: "Standard",
    token: "--np-ease-standard",
    note: "Exits only. Nothing entering the screen uses a plain ease.",
  },
] as const

export function SpringDemo() {
  const [at, setAt] = useState(false)
  const [slow, setSlow] = useState(false)
  const duration = slow ? "1600ms" : "var(--np-duration-overlay)"

  return (
    <div className="flex flex-col gap-4 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setAt((current) => !current)}
        >
          Play
        </Button>
        <label className="flex items-center gap-2 text-ui text-ink">
          Slow motion
          <Switch checked={slow} onCheckedChange={setSlow} />
        </label>
      </div>

      <ul className="flex flex-col gap-3">
        {CURVES.map((curve) => (
          <li
            key={curve.id}
            className="grid gap-2 sm:grid-cols-[12rem_1fr] sm:items-center"
          >
            <div className="flex flex-col">
              <p className="text-ui font-medium text-ink">{curve.label}</p>
              <p className="font-mono text-caption text-ink-muted">
                {curve.token}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <div
                aria-hidden
                className="@container relative h-8 rounded-(--np-radius-control) bg-fill-secondary"
              >
                <span
                  className="absolute top-1 left-1 block size-6 rounded-(--np-radius-pill) bg-primary transition-transform"
                  style={{
                    transform: at
                      ? "translateX(calc(100cqw - 2rem))"
                      : "translateX(0)",
                    transitionDuration: duration,
                    transitionTimingFunction: `var(${curve.token})`,
                  }}
                />
              </div>
              <p className="text-caption text-ink-muted">{curve.note}</p>
            </div>
          </li>
        ))}

        <li className="grid gap-2 sm:grid-cols-[12rem_1fr] sm:items-center">
          <div className="flex flex-col">
            <p className="text-ui font-medium text-ink">Overlay enter</p>
            <p className="font-mono text-caption text-ink-muted">
              scale 0.96 → 1, fade
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex h-20 items-center justify-center rounded-(--np-radius-control) bg-fill-secondary">
              <div
                aria-hidden
                className="w-56 origin-top rounded-(--np-radius-card) material-popover p-3 text-ui text-ink shadow-(--np-shadow-pop) transition-[opacity,scale]"
                style={{
                  opacity: at ? 1 : 0,
                  scale: at ? "1" : "0.96",
                  transitionDuration: at ? duration : "var(--np-duration-fast)",
                  transitionTimingFunction: at
                    ? "var(--np-ease-spring)"
                    : "var(--np-ease-standard)",
                }}
              >
                Reply published
                <span className="mt-0.5 block text-caption text-ink-muted">
                  Grows from its anchor on the spring, leaves fast.
                </span>
              </div>
            </div>
            <p className="text-caption text-ink-muted">
              Menus, popovers and dialogs enter on the spring over
              --np-duration-overlay and exit on the standard curve over
              --np-duration-fast.
            </p>
          </div>
        </li>
      </ul>
    </div>
  )
}
