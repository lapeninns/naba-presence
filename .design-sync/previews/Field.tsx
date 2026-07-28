import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  RadioGroup,
  RadioGroupItem,
  Switch,
  Textarea,
} from "NabaReview"

export function LabelledInput() {
  return (
    <FieldGroup className="max-w-sm">
      <Field>
        <FieldLabel htmlFor="signature">Reply signature</FieldLabel>
        <Input id="signature" defaultValue="Priya Sharma, Guest Relations" />
        <FieldDescription>
          Appended to every reply published to Google Business Profile.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="sla">Reply target</FieldLabel>
        <NativeSelect id="sla" defaultValue="24" className="w-full">
          <NativeSelectOption value="4">Within 4 hours</NativeSelectOption>
          <NativeSelectOption value="24">Within 24 hours</NativeSelectOption>
          <NativeSelectOption value="72">Within 3 days</NativeSelectOption>
        </NativeSelect>
        <FieldDescription>Applies to Central, Riverside and Airport.</FieldDescription>
      </Field>
    </FieldGroup>
  )
}

export function InvalidField() {
  return (
    <FieldGroup className="max-w-sm">
      <Field data-invalid="true">
        <FieldLabel htmlFor="draft">Reply to Lena Fischer</FieldLabel>
        <Textarea id="draft" aria-invalid defaultValue="Sorry about that." />
        <FieldError>Drafts must be at least 120 characters before publishing.</FieldError>
      </Field>
    </FieldGroup>
  )
}

export function HorizontalToggles() {
  return (
    <FieldGroup className="max-w-sm">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>Require human approval</FieldTitle>
          <FieldDescription>
            Generated drafts wait in the queue until a teammate publishes them.
          </FieldDescription>
        </FieldContent>
        <Switch defaultChecked aria-label="Require human approval" />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>Escalate one-star reviews</FieldTitle>
          <FieldDescription>Notify the duty manager within one hour.</FieldDescription>
        </FieldContent>
        <Switch aria-label="Escalate one-star reviews" />
      </Field>
    </FieldGroup>
  )
}

export function RadioCards() {
  return (
    <FieldSet className="max-w-sm">
      <FieldLegend variant="label">Default reply tone</FieldLegend>
      <FieldDescription>
        Sets the voice the draft generator uses for every new review.
      </FieldDescription>
      <RadioGroup defaultValue="warm">
        <FieldLabel htmlFor="tone-warm">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Warm and personal</FieldTitle>
              <FieldDescription>Thanks the guest by name, mentions details.</FieldDescription>
            </FieldContent>
            <RadioGroupItem value="warm" id="tone-warm" />
          </Field>
        </FieldLabel>
        <FieldLabel htmlFor="tone-neutral">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Neutral and factual</FieldTitle>
              <FieldDescription>Acknowledges the review, no embellishment.</FieldDescription>
            </FieldContent>
            <RadioGroupItem value="neutral" id="tone-neutral" />
          </Field>
        </FieldLabel>
      </RadioGroup>
    </FieldSet>
  )
}

export function WithSeparator() {
  return (
    <FieldGroup className="max-w-sm">
      <Field>
        <FieldLabel htmlFor="escalation-email">Escalation email</FieldLabel>
        <Input
          id="escalation-email"
          type="email"
          placeholder="duty.manager@lapeninns.com"
        />
      </Field>
      <FieldSeparator>Or</FieldSeparator>
      <Field>
        <FieldLabel htmlFor="escalation-owner">Escalate to a teammate</FieldLabel>
        <NativeSelect id="escalation-owner" defaultValue="tom" className="w-full">
          <NativeSelectOption value="priya">Priya Sharma</NativeSelectOption>
          <NativeSelectOption value="tom">Tom Okafor</NativeSelectOption>
          <NativeSelectOption value="lena">Lena Fischer</NativeSelectOption>
          <NativeSelectOption value="marco">Marco Silva</NativeSelectOption>
        </NativeSelect>
        <FieldDescription>Escalations appear in their NabaReview inbox.</FieldDescription>
      </Field>
    </FieldGroup>
  )
}
