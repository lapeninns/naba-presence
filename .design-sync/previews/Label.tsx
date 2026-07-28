import {
  Checkbox,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Label,
  Switch,
  Textarea,
} from "NabaReview"

export function Default() {
  return (
    <div className="grid w-full max-w-sm gap-2">
      <Label htmlFor="l-default">Location name</Label>
      <Input id="l-default" defaultValue="Lapen Inn — Riverside" />
    </div>
  )
}

export function ControlTypes() {
  return (
    <div className="grid w-full max-w-sm gap-5">
      <div className="grid gap-2">
        <Label htmlFor="l-input">Reply signature</Label>
        <Input id="l-input" defaultValue="— The team at Lapen Inn Riverside" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="l-textarea">Escalation note</Label>
        <Textarea
          id="l-textarea"
          rows={2}
          placeholder="Why is this review being escalated?"
        />
      </div>
      <div className="flex items-center gap-3">
        <Checkbox id="l-checkbox" defaultChecked />
        <Label htmlFor="l-checkbox">Notify the duty manager</Label>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="l-switch" defaultChecked />
        <Label htmlFor="l-switch">Auto-publish approved replies</Label>
      </div>
    </div>
  )
}

export function RequiredAndOptional() {
  return (
    <div className="grid w-full max-w-sm gap-4">
      <div className="grid gap-2">
        <Label htmlFor="l-required">
          Place ID
          <span className="text-destructive" aria-hidden>
            *
          </span>
        </Label>
        <Input id="l-required" required className="font-mono" placeholder="ChIJ…" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="l-optional" className="justify-between">
          Escalation contact
          <span className="text-xs font-normal text-muted-foreground">Optional</span>
        </Label>
        <Input id="l-optional" type="email" placeholder="duty.manager@lapeninns.com" />
      </div>
    </div>
  )
}

export function Disabled() {
  return (
    <div className="grid w-full max-w-sm gap-5">
      <Field data-disabled="true">
        <FieldLabel htmlFor="l-disabled">Owner email</FieldLabel>
        <Input id="l-disabled" disabled defaultValue="owner@lapeninns.com" />
        <FieldDescription>Requires owner access on the Google account.</FieldDescription>
      </Field>
      <Field data-disabled="true" orientation="horizontal">
        <Checkbox id="l-disabled-check" disabled />
        <FieldLabel htmlFor="l-disabled-check">Import historic reviews</FieldLabel>
      </Field>
    </div>
  )
}
