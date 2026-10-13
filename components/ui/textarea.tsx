"use client"

import * as React from "react"

import {
  fieldChromeClassName,
  fieldControlProps,
  useFieldContext,
} from "@/components/ui/field"
import { cn } from "@/lib/utils"

/** One line of textarea text, and the chrome around the lines (7px padding top and bottom, 1px edges). */
const LINE_PX = 22
const CHROME_PX = 16

function rowsToPx(rows: number) {
  return rows * LINE_PX + CHROME_PX
}

/**
 * `field-sizing: content` grows the box with its text in CSS alone (Chromium
 * 123+, Safari 26+). Older engines get the classic fallback: measure
 * `scrollHeight` after each change and set the height, clamped to the rows.
 */
function supportsFieldSizing() {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("field-sizing", "content")
  )
}

export type TextareaProps = React.ComponentProps<"textarea"> & {
  /**
   * Grow with the text instead of scrolling inside a fixed box: a reply, a
   * note, a menu description. Starts at `minRows` and stops growing at
   * `maxRows`, after which it scrolls. Replaces the local
   * `field-sizing-content` classes in the menu editors.
   */
  autoSize?: boolean
  /** With `autoSize`: the starting height in lines. Default 3. */
  minRows?: number
  /** With `autoSize`: the tallest it grows, in lines. Default 12. */
  maxRows?: number
}

/**
 * Same chrome as Input. Without `autoSize` the minimum height is a few lines
 * rather than the field height, and it is user-resizable vertically at the
 * desk only: on a phone the grip is a 12px target in the corner that fights
 * the scroll gesture, and the box is already as wide as the screen.
 */
function Textarea({
  className,
  autoSize = false,
  minRows = 3,
  maxRows = 12,
  style,
  ref,
  onChange,
  ...props
}: TextareaProps) {
  const field = useFieldContext()
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null)

  const setRefs = (node: HTMLTextAreaElement | null) => {
    innerRef.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }

  const fit = React.useCallback(() => {
    const el = innerRef.current
    if (!autoSize || !el || supportsFieldSizing()) return
    el.style.height = "auto"
    const next = Math.min(
      Math.max(el.scrollHeight + 2, rowsToPx(minRows)),
      rowsToPx(maxRows)
    )
    el.style.height = `${next}px`
  }, [autoSize, minRows, maxRows])

  // Controlled values change without an input event (a draft restored, a
  // suggestion inserted), so measure after every render, not only on typing.
  React.useLayoutEffect(fit)

  return (
    <textarea
      ref={setRefs}
      data-slot="textarea"
      data-autosize={autoSize || undefined}
      className={cn(
        fieldChromeClassName,
        "w-full px-(--np-field-pad-x) py-(--np-field-pad-y) leading-[22px]",
        autoSize
          ? "field-sizing-content resize-none overflow-y-auto"
          : "min-h-24 resize-none desk:resize-y",
        className
      )}
      style={
        autoSize
          ? {
              minHeight: rowsToPx(minRows),
              maxHeight: rowsToPx(maxRows),
              ...style,
            }
          : style
      }
      onChange={(event) => {
        fit()
        onChange?.(event)
      }}
      {...fieldControlProps(field)}
      {...props}
    />
  )
}

export { Textarea }
