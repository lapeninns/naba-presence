import {
  Badge,
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Label,
  Switch,
} from "NabaReview"

export function WithLabel() {
  return (
    <div className="grid w-full max-w-sm gap-4">
      <div className="flex items-center gap-3">
        <Switch id="sw-auto" defaultChecked />
        <Label htmlFor="sw-auto">Auto-publish approved replies</Label>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="sw-digest" />
        <Label htmlFor="sw-digest">Daily digest email</Label>
      </div>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="grid w-full max-w-md gap-4">
      <div className="flex items-center gap-5">
        <span className="min-w-16 text-sm font-medium">default</span>
        <Switch size="default" defaultChecked aria-label="Sync Central" />
        <Switch size="default" aria-label="Sync Airport" />
        <span className="text-xs text-muted-foreground">settings rows</span>
      </div>
      <div className="flex items-center gap-5">
        <span className="min-w-16 text-sm font-medium">sm</span>
        <Switch size="sm" defaultChecked aria-label="Show rating column" />
        <Switch size="sm" aria-label="Show status column" />
        <span className="text-xs text-muted-foreground">toolbars and table rows</span>
      </div>
    </div>
  )
}

export function States() {
  return (
    <div className="grid w-full max-w-sm gap-4">
      <div className="flex items-center gap-3">
        <Switch id="st-on" defaultChecked />
        <Label htmlFor="st-on">Sync Central</Label>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="st-off" />
        <Label htmlFor="st-off">Sync Airport</Label>
      </div>
      <Field orientation="horizontal" data-disabled="true">
        <Switch id="st-disabled-on" defaultChecked disabled />
        <FieldLabel htmlFor="st-disabled-on">
          Escalate 1-star reviews (workspace policy)
        </FieldLabel>
      </Field>
      <Field orientation="horizontal" data-disabled="true">
        <Switch id="st-disabled-off" disabled />
        <FieldLabel htmlFor="st-disabled-off">
          Reply in the reviewer&rsquo;s language (beta)
        </FieldLabel>
      </Field>
    </div>
  )
}

export function SettingsList() {
  return (
    <FieldGroup className="max-w-md">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="s-thanks">Auto-reply to 5-star reviews</FieldLabel>
          <FieldDescription>
            Posts the approved thank-you template within 10 minutes.
          </FieldDescription>
        </FieldContent>
        <Switch id="s-thanks" defaultChecked />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="s-escalate">
            Escalate 1-star reviews
            <Badge variant="secondary">Recommended</Badge>
          </FieldLabel>
          <FieldDescription>
            Notifies the duty manager instead of drafting a reply.
          </FieldDescription>
        </FieldContent>
        <Switch id="s-escalate" defaultChecked />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="s-translate">Reply in the reviewer&rsquo;s language</FieldLabel>
          <FieldDescription>
            Detected from the review text — 4 languages live so far.
          </FieldDescription>
        </FieldContent>
        <Switch id="s-translate" />
      </Field>
    </FieldGroup>
  )
}
