import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Label,
  Textarea,
} from "NabaReview"

const DRAFT =
  "Thank you for the kind words, Priya — I'll pass them on to the front desk team. " +
  "We're glad the room and breakfast landed well, and we hope to welcome you back to " +
  "Lapen Inn Central soon."

// The DS Textarea sets `field-sizing-content`, so `rows` has no effect: the box
// rests at min-h-16 and grows with its content.
export function Default() {
  return (
    <div className="grid w-full max-w-md gap-2">
      <Label htmlFor="reply-empty">Reply draft</Label>
      <Textarea id="reply-empty" placeholder="Write a reply to Priya Sharma…" />
    </div>
  )
}

export function WithValue() {
  return (
    <div className="grid w-full max-w-md gap-4">
      <div className="grid gap-2">
        <Label htmlFor="reply-short">Reply to Marco Silva</Label>
        <Textarea
          id="reply-short"
          defaultValue="Thanks, Marco — see you on the next trip through the airport."
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="reply-filled">Reply to Priya Sharma</Label>
        <Textarea id="reply-filled" defaultValue={DRAFT} />
      </div>
    </div>
  )
}

export function WithDescription() {
  return (
    <FieldGroup className="max-w-md">
      <Field>
        <FieldLabel htmlFor="reply-desc">Reply draft</FieldLabel>
        <Textarea id="reply-desc" defaultValue={DRAFT} />
        <div className="flex items-center justify-between gap-4">
          <FieldDescription>
            Posts publicly to Google under the location name.
          </FieldDescription>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            218 / 4096
          </span>
        </div>
      </Field>
      <Field>
        <FieldLabel htmlFor="internal-note">Internal note</FieldLabel>
        <Textarea
          id="internal-note"
          placeholder="Only visible to the review team"
        />
      </Field>
    </FieldGroup>
  )
}

export function Invalid() {
  return (
    <FieldGroup className="max-w-md">
      <Field>
        <FieldLabel htmlFor="reply-valid">Reply to Tom Okafor</FieldLabel>
        <Textarea
          id="reply-valid"
          defaultValue="Thanks for flagging the slow check-in, Tom — we've added a second desk agent on Friday evenings and hope the next stay runs smoother."
        />
        <FieldDescription>Ready to post — 148 characters.</FieldDescription>
      </Field>
      <Field data-invalid="true">
        <FieldLabel htmlFor="reply-invalid">Reply to Lena Fischer</FieldLabel>
        <Textarea id="reply-invalid" aria-invalid defaultValue="Sorry." />
        <FieldError>
          Escalated reviews need a reply of at least 120 characters.
        </FieldError>
      </Field>
    </FieldGroup>
  )
}

export function Disabled() {
  return (
    <FieldGroup className="max-w-md">
      <Field>
        <FieldLabel htmlFor="posted-reply">Posted reply</FieldLabel>
        <Textarea
          id="posted-reply"
          readOnly
          defaultValue="Thanks for staying with us, Marco — see you on the next trip through the airport."
        />
        <FieldDescription>
          Read-only — posted 14 May 2024, edit on Google to change it.
        </FieldDescription>
      </Field>
      <Field data-disabled="true">
        <FieldLabel htmlFor="reply-locked">Reply draft</FieldLabel>
        <Textarea id="reply-locked" disabled defaultValue={DRAFT} />
        <FieldDescription>
          Locked while this review is awaiting legal review.
        </FieldDescription>
      </Field>
    </FieldGroup>
  )
}
