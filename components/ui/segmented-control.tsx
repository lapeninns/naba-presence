"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { cva, type VariantProps } from "class-variance-authority"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"

import { COUNT_TEXT_CLASS } from "@/components/ui/count-text"
import { useFieldTriggerProps } from "@/components/ui/field"
import { cn } from "@/lib/utils"

/**
 * The segmented control: one track, one white raised thumb on the chosen
 * segment, and THREE possible meanings. The look is fixed; `semantics` picks
 * what the control tells assistive tech and the keyboard.
 *
 * Which semantics?
 * - `"tabs"` (default) — the items switch VIEWS OF THE SAME DATA: a calendar's
 *   Month / Week / Agenda, a board's health filter. Base UI Tabs: a tablist,
 *   the selected tab is the one tab stop, arrows (and Home/End) move AND
 *   select, and a `TabsPanel` can be attached by value where a real panel
 *   exists.
 * - `"radio"` — the user is CHOOSING A VALUE in a form: a reply tone, a
 *   filter-sheet option, a yes/no/unset answer (see `TriState`). Base UI
 *   RadioGroup: radiogroup/radio, one tab stop, arrows move and select,
 *   `name`/`required` take part in the form, and inside a `Field` the
 *   Field's label names the group.
 * - `"toggle"` — ONE FORM IN TWO SHAPES, or a display mode of one surface:
 *   sign-in's password / magic link, the hours editor's view mode, photos'
 *   grid / list. Base UI ToggleGroup: buttons reporting `aria-pressed`,
 *   arrows move focus (Enter/Space press), single value only, and never
 *   empty unless `allowEmpty`.
 *
 * If none of these fit — eleven options, long labels, choices that need a
 * description — the control is the wrong object: use a radio list or a
 * Select instead of a track that has to scroll.
 *
 * Reference `.segmented`: a hover-fill track with 3px padding and a 10px
 * radius, whose outer height is `--np-control-h` (44px on touch, 36px at the
 * desk); segments in the strong secondary ink; the selected segment is drawn
 * as a white thumb with the raised shadow (styled on the segment itself, so
 * it never depends on a measured indicator). A track longer than its room
 * scrolls sideways inside itself, snapping to segments, with an edge fade on
 * whichever side has more to show.
 */

type Semantics = "tabs" | "radio" | "toggle"

type SegmentedContextValue = {
  semantics: Semantics
  disabled: boolean
}

const SegmentedContext = createContext<SegmentedContextValue>({
  semantics: "tabs",
  disabled: false,
})

/**
 * The three recipes the control is made of, exported so a surface that needs
 * different SEMANTICS than the component offers can still be the same
 * OBJECT. Copying the strings instead is how a track on one screen quietly
 * stops matching the track on the next.
 *
 * The thumb now lives in the item recipe too, keyed off every "selected"
 * signal a segment can carry — `aria-pressed` (a plain button),
 * `data-active` (Tabs), `data-checked` (Radio), `data-pressed` (Toggle) — so
 * an adopter no longer has to remember to add it. `segmentedThumbClassName`
 * stays exported for the ones that still do; adding it twice is harmless.
 */
const segmentedThumbClassName = cn("rounded-[7px] bg-surface shadow-np-raised")

const segmentedItemClassName = cn(
  // Height is the control token less the track's 3px padding top and
  // bottom, so the TRACK is exactly `--np-control-h`: 44px on touch, 36px at
  // the desk, and the compact density's 30px where a subtree opts in. No
  // `pointer-coarse:` patch — the token already carries the touch size.
  //
  // `flex-[1_0_auto]` rather than the old `flex-1 min-w-0`: segments still
  // grow to fill a wide track, but never shrink below their label. Shrinking
  // is what truncated "Needs attention" to "N" at 360px; now the track
  // scrolls instead. Written as the `flex` shorthand so a caller's
  // `flex-none` still replaces it through tailwind-merge.
  "relative z-10 inline-flex h-[calc(var(--np-control-h)-2*var(--np-segment-inset))] flex-[1_0_auto] snap-start items-center justify-center gap-1.5 rounded-[7px] px-3 text-ui font-medium whitespace-nowrap text-ink-secondary focus-halo outline-none select-none",
  // The hit area: the visible segment is 6px shorter than the track, so a
  // transparent pseudo-element reaches over the track's padding and the
  // whole 44px of track height on touch is tappable. It stays inside the
  // track's padding box, so the scroll container never clips it.
  "after:absolute after:inset-x-0 after:-inset-y-(--np-segment-inset)",
  "transition-[color,background-color,box-shadow] duration-(--np-duration-fast) ease-spring-snappy",
  "hover:text-ink",
  // Written out in full, not built from a helper: Tailwind only generates
  // classes it can read literally in the source.
  "aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-np-raised",
  "data-active:bg-surface data-active:text-ink data-active:shadow-np-raised",
  "data-checked:bg-surface data-checked:text-ink data-checked:shadow-np-raised",
  "data-pressed:bg-surface data-pressed:text-ink data-pressed:shadow-np-raised",
  "disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50",
  "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
)

const itemSelector = "[data-slot=segmented-control-item]"

const trackVariants = cva(
  [
    "relative isolate flex w-full max-w-full min-w-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-[10px] bg-fill p-(--np-segment-inset)",
    // Snap to segments, and keep 24px of scroll padding so a snapped
    // segment lands just clear of the start fade with the previous one
    // peeking through it — the cue that there is more behind.
    "snap-x snap-mandatory scroll-px-6",
    "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
    // The scroll cue. A fade appears only on a side that has more to show;
    // `useSegmentedOverflow` sets the data attributes from the real scroll
    // position, so a track that fits is never masked at all.
    "data-overflow-end:[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)]",
    "data-overflow-start:[mask-image:linear-gradient(to_left,#000_calc(100%-24px),transparent)]",
    "data-overflow-start:data-overflow-end:[mask-image:linear-gradient(to_right,transparent,#000_24px,#000_calc(100%-24px),transparent)]",
  ],
  {
    variants: {
      size: {
        // Smaller at the desk only. On touch the small track keeps the full
        // 44px: `--np-control-h-sm` is 36px there, under the touch floor.
        sm: "desk:[&_[data-slot=segmented-control-item]]:h-[calc(var(--np-control-h-sm)-2*var(--np-segment-inset))]",
        default: "",
      },
      fill: {
        true: "",
        // Segments sized to their labels, the track no wider than they are.
        false: "[&_[data-slot=segmented-control-item]]:flex-none",
      },
    },
    defaultVariants: { size: "default", fill: true },
  }
)

/** The visible track: the hover-fill grey with 3px of padding. */
const segmentedTrackClassName = trackVariants({ size: "default" })

function setFlag(element: HTMLElement, name: string, on: boolean) {
  if (on) element.setAttribute(name, "")
  else element.removeAttribute(name)
}

/**
 * Marks a horizontally scrolling track with `data-overflow-start` /
 * `data-overflow-end` while there is more content in that direction, which
 * is what turns the edge fades on.
 *
 * Writes attributes straight onto the element rather than through state:
 * this runs on every scroll frame, and a re-render of every segment per
 * frame buys nothing. Re-measures when the track or any segment resizes
 * (a count changing width, the viewport rotating) and when segments are
 * added or removed. Exported for adopters that draw the track themselves.
 */
export function useSegmentedOverflow(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const track = ref.current
    if (!track) return

    let frame = 0
    const update = () => {
      frame = 0
      const max = track.scrollWidth - track.clientWidth
      // `abs` because an RTL track scrolls into negative values.
      const left = Math.abs(track.scrollLeft)
      setFlag(track, "data-overflow-start", max > 1 && left > 1)
      setFlag(track, "data-overflow-end", max > 1 && left < max - 1)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule)
    const observeAll = () => {
      if (!resize) return
      resize.disconnect()
      resize.observe(track)
      for (const child of Array.from(track.children)) resize.observe(child)
    }
    const mutation =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            observeAll()
            schedule()
          })

    update()
    observeAll()
    mutation?.observe(track, { childList: true })
    track.addEventListener("scroll", schedule, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      resize?.disconnect()
      mutation?.disconnect()
      track.removeEventListener("scroll", schedule)
    }
  }, [ref])
}

/**
 * Keeps the selected segment visible inside a scrolling track, on mount and
 * whenever the selection changes — otherwise a deep-linked "To publish"
 * filter could be selected and off-screen at 360px.
 *
 * Sets the track's `scrollLeft` directly instead of `scrollIntoView`, which
 * also scrolls every scrollable ancestor — the page included — and would
 * jump a phone's viewport to a toolbar on load. The 24px margin clears the
 * edge fade. Reads the DOM for the selected segment, so it works whichever
 * attribute (`data-active`, `data-checked`, `data-pressed`) marks it.
 */
function useRevealSelected(
  ref: React.RefObject<HTMLElement | null>,
  selected: unknown
) {
  useEffect(() => {
    const track = ref.current
    if (!track || track.scrollWidth <= track.clientWidth) return
    const item = track.querySelector<HTMLElement>(
      `${itemSelector}:is([data-active],[data-checked],[data-pressed])`
    )
    if (!item) return
    const margin = 24
    const start = item.offsetLeft
    const end = start + item.offsetWidth
    if (start - margin < track.scrollLeft) {
      track.scrollLeft = Math.max(0, start - margin)
    } else if (end + margin > track.scrollLeft + track.clientWidth) {
      track.scrollLeft = end + margin - track.clientWidth
    }
  }, [ref, selected])
}

/**
 * Value bookkeeping shared by every mode: controlled when `value` is given,
 * otherwise held here. Held here (not only inside Base UI) because the
 * reveal effect needs to know when the selection moved.
 */
function useSelection(
  value: string | undefined,
  defaultValue: string | undefined,
  onValueChange: ((value: string) => void) | undefined
) {
  const [internal, setInternal] = useState(defaultValue)
  const controlled = value !== undefined
  const selected = controlled ? value : internal
  const select = useCallback(
    (next: string) => {
      if (!controlled) setInternal(next)
      onValueChange?.(next)
    },
    [controlled, onValueChange]
  )
  return [selected, select] as const
}

export type SegmentedControlProps = Omit<
  TabsPrimitive.Root.Props,
  "value" | "defaultValue" | "onValueChange"
> &
  VariantProps<typeof trackVariants> & {
    /** What the control means; see the guide above. Defaults to `"tabs"`. */
    semantics?: Semantics
    value?: string
    defaultValue?: string
    onValueChange?: (value: string) => void
    /** Reaches the inner group (tablist / radiogroup / group): the visible track. */
    trackClassName?: string
    "aria-label"?: string
    "aria-labelledby"?: string
    /** Disables every segment. */
    disabled?: boolean
    /** `radio` only: the form field name the chosen value is submitted as. */
    name?: string
    /** `radio` only: the group must have a value for the form to submit. */
    required?: boolean
    /**
     * `toggle` only: pressing the pressed segment releases it and reports
     * `""`. Off by default — a mode switch with no mode is not a state.
     */
    allowEmpty?: boolean
  }

function SegmentedControl({
  semantics = "tabs",
  disabled = false,
  name,
  required,
  allowEmpty,
  orientation,
  ...props
}: SegmentedControlProps) {
  // Each mode is handed only the props it means something to: `name` and
  // `required` belong to a form value (radio), `allowEmpty` to a pressed
  // state (toggle), and `orientation` stays with the Tabs root it was typed
  // for — the track is always horizontal.
  return (
    <SegmentedContext.Provider value={{ semantics, disabled }}>
      {semantics === "radio" ? (
        <SegmentedRadio
          disabled={disabled}
          name={name}
          required={required}
          {...props}
        />
      ) : semantics === "toggle" ? (
        <SegmentedToggle
          disabled={disabled}
          allowEmpty={allowEmpty}
          {...props}
        />
      ) : (
        <SegmentedTabs orientation={orientation} {...props} />
      )}
    </SegmentedContext.Provider>
  )
}

type ModeProps = Omit<
  SegmentedControlProps,
  "semantics" | "disabled" | "name" | "required" | "allowEmpty"
>

function SegmentedTabs({
  className,
  trackClassName,
  size,
  fill,
  value,
  defaultValue,
  onValueChange,
  children,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: ModeProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [selected, select] = useSelection(value, defaultValue, onValueChange)
  useSegmentedOverflow(trackRef)
  useRevealSelected(trackRef, selected)

  return (
    <TabsPrimitive.Root
      data-slot="segmented-control"
      className={cn("inline-flex max-w-full", className)}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => {
        if (typeof next === "string") select(next)
      }}
      {...props}
    >
      <TabsPrimitive.List
        ref={trackRef}
        data-slot="segmented-control-track"
        activateOnFocus
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={cn(trackVariants({ size, fill }), trackClassName)}
      >
        {children}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}

/**
 * Root props a Tabs root accepts that the radio and toggle wrappers pass to
 * their outer `<div>`. Cast once here: Base UI types `className`/`render` per
 * component state, but the outer wrapper is a plain element.
 */
type WrapperProps = React.ComponentProps<"div">

/** What `useFieldTriggerProps` hands a group; `{}` outside a Field. */
type FieldGroupProps = {
  id?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
  "aria-labelledby"?: string
}

function SegmentedRadio({
  className,
  trackClassName,
  size,
  fill,
  value,
  defaultValue,
  onValueChange,
  children,
  disabled,
  name,
  required,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  ...props
}: Omit<ModeProps, "orientation"> &
  Pick<SegmentedControlProps, "disabled" | "name" | "required">) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [selected, select] = useSelection(value, defaultValue, onValueChange)
  // Inside a Field, the Field's label names the group (a radiogroup is not
  // something `<label for>` can reach) unless the caller named it already.
  const fieldProps: FieldGroupProps = useFieldTriggerProps({
    hasOwnName: Boolean(ariaLabel || ariaLabelledBy),
  })
  useSegmentedOverflow(trackRef)
  useRevealSelected(trackRef, selected)

  return (
    <div
      data-slot="segmented-control"
      className={cn("inline-flex max-w-full", className as string)}
      {...(props as WrapperProps)}
    >
      <RadioGroupPrimitive<string | null>
        ref={trackRef}
        data-slot="segmented-control-track"
        {...fieldProps}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy ?? fieldProps["aria-labelledby"]}
        aria-describedby={ariaDescribedBy ?? fieldProps["aria-describedby"]}
        // `null`, not `undefined`, when nothing is chosen: undefined would
        // hand the value back to Base UI as uncontrolled.
        value={selected ?? null}
        onValueChange={(next) => {
          if (typeof next === "string") select(next)
        }}
        disabled={disabled}
        name={name}
        required={required}
        className={cn(trackVariants({ size, fill }), trackClassName)}
      >
        {children}
      </RadioGroupPrimitive>
    </div>
  )
}

function SegmentedToggle({
  className,
  trackClassName,
  size,
  fill,
  value,
  defaultValue,
  onValueChange,
  children,
  disabled,
  allowEmpty = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  ...props
}: Omit<ModeProps, "orientation"> &
  Pick<SegmentedControlProps, "disabled" | "allowEmpty">) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [selected, select] = useSelection(value, defaultValue, onValueChange)
  const fieldProps: FieldGroupProps = useFieldTriggerProps({
    hasOwnName: Boolean(ariaLabel || ariaLabelledBy),
  })
  useSegmentedOverflow(trackRef)
  useRevealSelected(trackRef, selected)

  return (
    <div
      data-slot="segmented-control"
      className={cn("inline-flex max-w-full", className as string)}
      {...(props as WrapperProps)}
    >
      <ToggleGroupPrimitive<string>
        ref={trackRef}
        data-slot="segmented-control-track"
        {...fieldProps}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy ?? fieldProps["aria-labelledby"]}
        aria-describedby={ariaDescribedBy ?? fieldProps["aria-describedby"]}
        // ToggleGroup speaks arrays; this control speaks one string. Always
        // controlled from here so a press on the pressed segment — which
        // Base UI reports as an empty array — can simply be refused.
        value={selected ? [selected] : []}
        onValueChange={(next) => {
          const pressed = next[0]
          if (pressed !== undefined) select(pressed)
          else if (allowEmpty) select("")
        }}
        disabled={disabled}
        className={cn(trackVariants({ size, fill }), trackClassName)}
      >
        {children}
      </ToggleGroupPrimitive>
    </div>
  )
}

export type SegmentedControlItemProps = Omit<
  TabsPrimitive.Tab.Props,
  "value"
> & {
  value: string
  /**
   * A figure after the label — "Needs attention 3" — in mono tabular
   * numerals so a changing count does not shift its neighbours. Part of the
   * segment's accessible name.
   */
  count?: React.ReactNode
}

/**
 * One segment. Reads the mode from its `SegmentedControl`, so the same
 * children work as a tab, a radio or a toggle button.
 */
function SegmentedControlItem({
  className,
  children,
  count,
  disabled,
  value,
  ...props
}: SegmentedControlItemProps) {
  const context = useContext(SegmentedContext)
  const isDisabled = disabled ?? (context.disabled || undefined)
  const shared = {
    "data-slot": "segmented-control-item",
    className: cn(segmentedItemClassName, className as string),
  }
  const content = (
    <>
      {children}
      {count !== undefined && count !== null ? (
        <>
          {/* A real space, so the accessible name reads "Needs attention 3"
              rather than "Needs attention3"; flex layout drops it visually
              and `gap` does the spacing. */}{" "}
          <span
            data-slot="segmented-control-count"
            className={cn(COUNT_TEXT_CLASS, "text-ink-muted")}
          >
            {count}
          </span>
        </>
      ) : null}
    </>
  )

  if (context.semantics === "radio") {
    return (
      <RadioPrimitive.Root
        {...(props as Omit<RadioPrimitive.Root.Props<string>, "value">)}
        {...shared}
        value={value}
        disabled={isDisabled}
      >
        {content}
      </RadioPrimitive.Root>
    )
  }

  if (context.semantics === "toggle") {
    return (
      <TogglePrimitive<string>
        {...(props as Omit<TogglePrimitive.Props<string>, "value">)}
        {...shared}
        value={value}
        disabled={isDisabled}
      >
        {content}
      </TogglePrimitive>
    )
  }

  return (
    <TabsPrimitive.Tab
      {...props}
      {...shared}
      value={value}
      disabled={isDisabled}
    >
      {content}
    </TabsPrimitive.Tab>
  )
}

export {
  SegmentedControl,
  SegmentedControlItem,
  segmentedItemClassName,
  segmentedThumbClassName,
  segmentedTrackClassName,
}
