import { Label, RadioGroup, RadioGroupItem } from "NabaReview"

export function ReplyTone() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <span className="text-sm font-medium text-foreground">Default reply tone</span>
      <RadioGroup defaultValue="warm">
        <Label className="gap-3 font-normal">
          <RadioGroupItem value="warm" />
          Warm and personal
        </Label>
        <Label className="gap-3 font-normal">
          <RadioGroupItem value="neutral" />
          Neutral and factual
        </Label>
        <Label className="gap-3 font-normal">
          <RadioGroupItem value="formal" />
          Formal brand voice
        </Label>
      </RadioGroup>
    </div>
  )
}

export function WithDescriptions() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <span className="text-sm font-medium text-foreground">Escalation policy</span>
      <RadioGroup defaultValue="one-star">
        <Label className="items-start gap-3 font-normal">
          <RadioGroupItem value="one-star" className="mt-0.5" />
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">One-star only</span>
            <span className="text-sm text-muted-foreground">
              Escalate to the duty manager at Central within 1 hour.
            </span>
          </span>
        </Label>
        <Label className="items-start gap-3 font-normal">
          <RadioGroupItem value="two-star" className="mt-0.5" />
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">One and two stars</span>
            <span className="text-sm text-muted-foreground">
              Escalate anything below 3.0 across all three properties.
            </span>
          </span>
        </Label>
        <Label className="items-start gap-3 font-normal">
          <RadioGroupItem value="never" className="mt-0.5" />
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">Never escalate</span>
            <span className="text-sm text-muted-foreground">
              Every review stays in the shared reply queue.
            </span>
          </span>
        </Label>
      </RadioGroup>
    </div>
  )
}

export function Horizontal() {
  return (
    <div className="flex w-full flex-col gap-3">
      <span className="text-sm font-medium text-foreground">Location</span>
      <RadioGroup defaultValue="riverside" className="flex flex-row flex-wrap gap-4">
        <Label className="gap-2 font-normal">
          <RadioGroupItem value="all" />
          All
        </Label>
        <Label className="gap-2 font-normal">
          <RadioGroupItem value="central" />
          Central
        </Label>
        <Label className="gap-2 font-normal">
          <RadioGroupItem value="riverside" />
          Riverside
        </Label>
        <Label className="gap-2 font-normal">
          <RadioGroupItem value="airport" />
          Airport
        </Label>
      </RadioGroup>
    </div>
  )
}

export function Disabled() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium text-foreground">Publish mode</span>
        <RadioGroup defaultValue="review">
          <Label className="gap-3 font-normal">
            <RadioGroupItem value="review" />
            Send drafts for review
          </Label>
          {/* Base UI radios render a <span role="radio"> and mark disabled with
              data-disabled / aria-disabled — never the `disabled` attribute — so
              the dimmed look comes from a group-data-disabled wrapper, not from
              the `disabled:` variants. */}
          <div className="group" data-disabled="true">
            <Label className="gap-3 font-normal">
              <RadioGroupItem value="auto" disabled />
              Publish automatically
              <span className="text-xs text-muted-foreground">(needs owner consent)</span>
            </Label>
          </div>
        </RadioGroup>
      </div>
      <div className="group flex flex-col gap-3" data-disabled="true">
        <span className="text-sm font-medium text-muted-foreground">
          Airport reply schedule
        </span>
        <RadioGroup defaultValue="business" disabled>
          <Label className="gap-3 font-normal">
            <RadioGroupItem value="business" />
            Business hours
          </Label>
          <Label className="gap-3 font-normal">
            <RadioGroupItem value="always" />
            Around the clock
          </Label>
        </RadioGroup>
      </div>
    </div>
  )
}
