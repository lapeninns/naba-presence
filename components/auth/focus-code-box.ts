/**
 * Focuses the first box of an `OtpField`. The boxes are Base UI's and expose
 * no ref, so this takes the field's root and finds its first visible input
 * (the hidden form input carries `aria-hidden`).
 */
export function focusFirstCodeBox(root: HTMLElement | null) {
  root
    ?.querySelector<HTMLInputElement>('input:not([aria-hidden="true"])')
    ?.focus()
}
