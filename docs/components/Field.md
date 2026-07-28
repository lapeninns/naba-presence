---
category: Forms
---

Layout and accessibility scaffolding for a labelled control.

Wrap a control in `Field` with `FieldLabel`, `FieldDescription`, and `FieldError` to get consistent spacing and wiring. Group related fields in `FieldGroup`, or in `FieldSet` with `FieldLegend` for a titled section. Prefer this over hand-built label/input stacks.

## Parts

Composed inside `<Field>`, each importable from `window.NabaReview.*`:

- `FieldContent`
- `FieldDescription`
- `FieldError`
- `FieldGroup`
- `FieldLabel`
- `FieldLegend`
- `FieldSeparator`
- `FieldSet`
- `FieldTitle`
