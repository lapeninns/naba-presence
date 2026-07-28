import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Label,
} from "NabaReview"

export function Default() {
  return (
    <div className="grid w-full max-w-sm gap-4">
      <div className="grid gap-2">
        <Label htmlFor="reviewer">Reviewer name</Label>
        <Input id="reviewer" placeholder="e.g. Priya Sharma" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="location-name">Location name</Label>
        <Input id="location-name" defaultValue="Lapen Inn — Central" />
      </div>
    </div>
  )
}

export function Types() {
  return (
    <div className="grid w-full max-w-2xl grid-cols-2 gap-4">
      <div className="grid gap-2">
        <Label htmlFor="t-search">Search reviews</Label>
        <Input id="t-search" type="search" placeholder="Reviewer, keyword, or ID" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="t-email">Escalation contact</Label>
        <Input id="t-email" type="email" defaultValue="duty.manager@lapeninns.com" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="t-tel">Front desk</Label>
        <Input id="t-tel" type="tel" defaultValue="+44 20 7946 0112" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="t-number">Escalate below rating</Label>
        <Input id="t-number" type="number" min={1} max={5} defaultValue={3} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="t-date">Reviews since</Label>
        <Input id="t-date" type="date" defaultValue="2024-04-01" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="t-time">Digest sends at</Label>
        <Input id="t-time" type="time" defaultValue="08:30" />
      </div>
    </div>
  )
}

export function WithDescription() {
  return (
    <FieldGroup className="max-w-sm">
      <Field>
        <FieldLabel htmlFor="signature">Reply signature</FieldLabel>
        <Input id="signature" defaultValue="— The team at Lapen Inn Central" />
        <FieldDescription>
          Appended to every reply posted from this location.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="sla">Reply target (hours)</FieldLabel>
        <Input id="sla" type="number" defaultValue={24} className="font-mono" />
        <FieldDescription>
          Reviews older than this move to the escalation queue.
        </FieldDescription>
      </Field>
    </FieldGroup>
  )
}

export function Invalid() {
  return (
    <FieldGroup className="max-w-sm">
      <Field>
        <FieldLabel htmlFor="place-ok">Place ID</FieldLabel>
        <Input
          id="place-ok"
          className="font-mono"
          defaultValue="ChIJd8BlQ2BZwokRAFUEcm9qrcA"
        />
        <FieldDescription>Google Business Profile → Settings.</FieldDescription>
      </Field>
      <Field data-invalid="true">
        <FieldLabel htmlFor="place-bad">Place ID</FieldLabel>
        <Input
          id="place-bad"
          aria-invalid
          className="font-mono"
          defaultValue="lapen-central"
        />
        <FieldError>Enter the full Google Business Profile place ID.</FieldError>
      </Field>
    </FieldGroup>
  )
}

export function DisabledAndReadOnly() {
  return (
    <FieldGroup className="max-w-sm">
      <Field>
        <FieldLabel htmlFor="last-sync">Last sync</FieldLabel>
        <Input
          id="last-sync"
          readOnly
          className="font-mono"
          defaultValue="2024-05-15 11:56 UTC"
        />
        <FieldDescription>Read-only — written by the sync worker.</FieldDescription>
      </Field>
      <Field data-disabled="true">
        <FieldLabel htmlFor="owner-email">Owner email</FieldLabel>
        <Input id="owner-email" disabled defaultValue="owner@lapeninns.com" />
        <FieldDescription>Requires owner access on the Google account.</FieldDescription>
      </Field>
    </FieldGroup>
  )
}
