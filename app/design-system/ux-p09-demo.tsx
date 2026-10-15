import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { TypedConfirmation } from "@/components/ui/typed-confirmation"

/**
 * Form primitives from the UX flows audit (P09): a desk measure for short
 * single-line fields, and the keyboard a typed confirmation opens.
 */
export function UxP09Demo() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h3 className="text-caption font-medium text-ink-muted">
          Field measure: short stays full width on a phone, at most max-w-md on
          a desk
        </h3>
        <Field measure="short">
          <FieldLabel>Agency name</FieldLabel>
          <Input defaultValue="Riverside Marketing" />
          <FieldDescription>
            Use <code>measure=&quot;short&quot;</code> for a name or a code.
            Long text keeps the default full width.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Notes (full width)</FieldLabel>
          <Input defaultValue="A long note fills the column" />
        </Field>
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-caption font-medium text-ink-muted">
          Typed confirmation: an email opens the email keyboard (with @)
        </h3>
        <TypedConfirmation expected="owner@riverside.test" />
      </div>
    </div>
  )
}
