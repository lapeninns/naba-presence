/**
 * Added to a full-width (`block`) auth button whose label is long enough to
 * outgrow a 320px phone. Buttons are `whitespace-nowrap` with a fixed
 * height, so a long label would spill past the card; this lets it wrap onto
 * a second, balanced line and grow, while `min-h-11` keeps the 44px touch
 * height of `size="lg"` for the usual single line.
 */
export const WRAPPING_BLOCK_BUTTON =
  "h-auto min-h-11 py-2.5 leading-snug text-balance whitespace-normal"
