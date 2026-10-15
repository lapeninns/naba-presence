"use client"

import { CheckIcon } from "lucide-react"
import * as React from "react"

import { ClientAvatar, colourFor } from "@/components/clients/client-avatar"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { CLIENT_COLOURS, clientColourName } from "@/lib/clients/colours"

/**
 * The client-mark colour picker: one choice from a short list, so it is a
 * radio group ("Pine, 2 of 6") drawn as swatches. Shared by New client and
 * the client's Details, so a colour picked at creation can be changed later
 * in the same control.
 *
 * A client without a chosen colour is drawn in one derived from its name
 * (`colourFor`), so that colour is the one shown as selected, and the preview
 * beside the swatches is the mark itself, drawn live from the name and the
 * choice. Nothing is stored until a swatch is picked; "Use the automatic
 * colour" goes back to that. Each swatch is named by its colour name, never
 * its hex code.
 *
 * The swatches are the stored values themselves; the chrome around them
 * (edge, ring, tick) is all tokens.
 */
function ClientColourField({
  value,
  onChange,
  name = "",
  description = "Used on the client’s mark so it is recognisable in a long list.",
}: {
  value: string | null
  onChange: (next: string | null) => void
  /** The client's name as typed, which the preview mark and the automatic colour follow. */
  name?: string
  description?: string
}) {
  const id = React.useId()
  const effective = colourFor(name, value)
  // The stored value, spelled as the list spells it, so the right swatch is
  // the checked one whatever case the server returned.
  const selected =
    CLIENT_COLOURS.find(
      (option) => option.value.toLowerCase() === effective.toLowerCase()
    )?.value ?? effective
  const colourName = clientColourName(effective) ?? "Custom colour"

  return (
    <div className="flex flex-col gap-1.5">
      <p id={`${id}-label`} className="text-ui font-semibold text-ink">
        Colour <span className="font-normal text-ink-muted">(optional)</span>
      </p>
      <p id={`${id}-description`} className="text-caption text-ink-muted">
        {description}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <ClientAvatar name={name} colour={value} size="lg" />
        <RadioGroup
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-description`}
          value={selected}
          onValueChange={(next) => onChange(String(next))}
          className="flex-row flex-wrap gap-2"
        >
          {CLIENT_COLOURS.map((option) => (
            <span key={option.value} className="group/swatch relative flex">
              <RadioGroupItem
                value={option.value}
                aria-label={option.name}
                style={{ "--swatch": option.value } as React.CSSProperties}
                className="size-8 rounded-(--np-radius-control) border border-line bg-(--swatch) transition-transform duration-(--np-duration-fast) ease-spring-snappy active:scale-[0.96] pointer-coarse:size-11 data-checked:border data-checked:border-line data-checked:outline-2 data-checked:outline-offset-2 data-checked:outline-ink"
              />
              {/* The tick is a second cue beside the ring, so the choice
                  never rests on colour alone. */}
              <CheckIcon
                aria-hidden
                strokeWidth={2.5}
                className="pointer-events-none absolute inset-0 m-auto size-4 text-primary-foreground opacity-0 group-has-data-checked/swatch:opacity-100"
              />
            </span>
          ))}
        </RadioGroup>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-caption text-ink-muted">
        <span>
          {colourName}
          {value === null ? " · chosen from the name" : null}
        </span>
        {value !== null ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onChange(null)}
          >
            Use the automatic colour
          </Button>
        ) : null}
      </p>
    </div>
  )
}

export { ClientColourField }
