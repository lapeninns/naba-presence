import {
  Button,
  Checkbox,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Label,
} from "NabaReview"
import { Star } from "lucide-react"

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={
            i <= value ? "size-4 fill-rating text-rating" : "size-4 text-muted-foreground/40"
          }
        />
      ))}
    </span>
  )
}

export function States() {
  return (
    <div className="grid w-full max-w-sm gap-4">
      <div className="flex items-center gap-3">
        <Checkbox id="cb-on" defaultChecked />
        <Label htmlFor="cb-on">Auto-publish approved replies</Label>
      </div>
      <div className="flex items-center gap-3">
        <Checkbox id="cb-off" />
        <Label htmlFor="cb-off">Email me every new review</Label>
      </div>
      <Field orientation="horizontal" data-disabled="true">
        <Checkbox id="cb-disabled-on" defaultChecked disabled />
        <FieldLabel htmlFor="cb-disabled-on">
          Escalate 1-star reviews (workspace policy)
        </FieldLabel>
      </Field>
      <Field orientation="horizontal" data-disabled="true">
        <Checkbox id="cb-disabled-off" disabled />
        <FieldLabel htmlFor="cb-disabled-off">
          Import historic reviews (owner access)
        </FieldLabel>
      </Field>
    </div>
  )
}

export function WithDescription() {
  return (
    <FieldGroup className="max-w-md">
      <Field orientation="horizontal">
        <Checkbox id="cb-escalate" defaultChecked />
        <FieldContent>
          <FieldLabel htmlFor="cb-escalate">Escalate 1-star reviews</FieldLabel>
          <FieldDescription>
            Emails the duty manager within 5 minutes of the review landing.
          </FieldDescription>
        </FieldContent>
      </Field>
      <Field orientation="horizontal">
        <Checkbox id="cb-digest" />
        <FieldContent>
          <FieldLabel htmlFor="cb-digest">Daily digest</FieldLabel>
          <FieldDescription>
            One email at 08:30 with every review that arrived overnight.
          </FieldDescription>
        </FieldContent>
      </Field>
    </FieldGroup>
  )
}

export function CheckboxGroupField() {
  return (
    <FieldSet className="max-w-sm">
      <FieldLegend variant="label">Locations to sync</FieldLegend>
      <FieldDescription>
        Reviews are pulled from Google Business Profile every 15 minutes.
      </FieldDescription>
      <div className="grid gap-3">
        <Field orientation="horizontal">
          <Checkbox id="loc-central" defaultChecked />
          <FieldLabel htmlFor="loc-central">Central</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="loc-riverside" defaultChecked />
          <FieldLabel htmlFor="loc-riverside">Riverside</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="loc-airport" />
          <FieldLabel htmlFor="loc-airport">Airport</FieldLabel>
        </Field>
      </div>
    </FieldSet>
  )
}

const QUEUE = [
  { id: "q1", name: "Priya Sharma", rating: 5, age: "2d", selected: true },
  { id: "q2", name: "Tom Okafor", rating: 4, age: "3d", selected: true },
  { id: "q3", name: "Lena Fischer", rating: 2, age: "5d", selected: false },
  { id: "q4", name: "Marco Silva", rating: 5, age: "1w", selected: false },
]

export function BulkSelect() {
  return (
    <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border">
      <div className="flex items-center justify-between gap-3 bg-muted px-4 py-2.5">
        <span className="text-sm font-medium">2 reviews selected</span>
        <Button size="xs" variant="outline">
          Assign replies
        </Button>
      </div>
      {QUEUE.map((r, i) => (
        <div
          key={r.id}
          className={
            i === 0
              ? "flex items-center gap-3 px-4 py-3"
              : "flex items-center gap-3 border-t border-border px-4 py-3"
          }
        >
          <Checkbox id={r.id} defaultChecked={r.selected} />
          <Label htmlFor={r.id} className="flex-1 font-normal">
            {r.name}
          </Label>
          <Stars value={r.rating} />
          <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">
            {r.age}
          </span>
        </div>
      ))}
    </div>
  )
}

export function Invalid() {
  return (
    <FieldGroup className="max-w-md">
      <Field orientation="horizontal">
        <Checkbox id="cb-reviewed" defaultChecked />
        <FieldContent>
          <FieldLabel htmlFor="cb-reviewed">
            A second reviewer has read this reply
          </FieldLabel>
          <FieldDescription>Signed off by Marco Silva, 12:04.</FieldDescription>
        </FieldContent>
      </Field>
      <Field orientation="horizontal" data-invalid="true">
        <Checkbox id="cb-policy" aria-invalid />
        <FieldContent>
          <FieldLabel htmlFor="cb-policy">
            I confirm this reply follows the Lapen Inns response policy
          </FieldLabel>
          <FieldError>Confirm the policy before posting to Google.</FieldError>
        </FieldContent>
      </Field>
    </FieldGroup>
  )
}
