"use client"

import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"

/** The radio values the three answers are submitted as when given a `name`. */
const YES = "true"
const NO = "false"
const UNSET = "unset"

export type TriStateLabels = {
  yes: string
  no: string
  unset: string
}

const defaultLabels: TriStateLabels = {
  yes: "Yes",
  no: "No",
  unset: "Not set",
}

export type TriStateProps = {
  /** `true`, `false`, or `null` for "no answer recorded". */
  value: boolean | null
  onValueChange: (next: boolean | null) => void
  /** Override any of the three words; the rest keep their defaults. */
  labels?: Partial<TriStateLabels>
  disabled?: boolean
  /** Submitted as `"true"`, `"false"` or `"unset"`. */
  name?: string
  className?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
}

/**
 * A yes / no / not-set answer as one segmented radio group: Yes, No,
 * Not set, in that order, each a full-height (44px on touch) segment.
 *
 * This replaces the Switch-plus-"Clear" pattern for optional booleans (a
 * Google attribute that may never have been answered). A Switch can only say
 * on or off, so "not set" had to be faked — a muted caption beside an off
 * switch, and a 24px ghost "Clear" button as the only way back to it.
 * Off-and-unset looked identical, and the escape hatch was the smallest
 * target on the row. Here all three states are visible, equal, and one
 * arrow key apart.
 *
 * Inside a `Field`, the Field's label names the group; outside one, give it
 * an `aria-label` or `aria-labelledby`.
 */
function TriState({
  value,
  onValueChange,
  labels,
  disabled,
  name,
  className,
  ...aria
}: TriStateProps) {
  const words = { ...defaultLabels, ...labels }
  return (
    <SegmentedControl
      semantics="radio"
      className={className}
      value={value === null ? UNSET : value ? YES : NO}
      onValueChange={(next) =>
        onValueChange(next === UNSET ? null : next === YES)
      }
      disabled={disabled}
      name={name}
      {...aria}
    >
      <SegmentedControlItem value={YES}>{words.yes}</SegmentedControlItem>
      <SegmentedControlItem value={NO}>{words.no}</SegmentedControlItem>
      <SegmentedControlItem value={UNSET}>{words.unset}</SegmentedControlItem>
    </SegmentedControl>
  )
}

export { TriState }
