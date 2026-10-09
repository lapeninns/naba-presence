/**
 * The client-mark colours. These are DATA, not theme: the chosen hex is
 * stored on the client (the API accepts a six-digit hex) and drawn on its
 * mark everywhere, so they are listed as values rather than tokens.
 *
 * One list for both uses: the swatches a person picks from, and the palette a
 * client without a chosen colour is given from its name. Two copies had
 * already been kept in step by hand.
 */
export const CLIENT_COLOURS = [
  { value: "#7A4E3B", name: "Umber" },
  { value: "#3F5E52", name: "Pine" },
  { value: "#4A4C7A", name: "Indigo" },
  { value: "#6B4A6B", name: "Plum" },
  { value: "#3E5B70", name: "Slate blue" },
  { value: "#6E5A2E", name: "Olive" },
] as const

export type ClientColour = (typeof CLIENT_COLOURS)[number]["value"]

/** A stored colour's swatch name, or null for a colour not on the list. */
export function clientColourName(value: string | null): string | null {
  if (!value) return null
  return (
    CLIENT_COLOURS.find(
      (colour) => colour.value.toLowerCase() === value.toLowerCase()
    )?.name ?? null
  )
}
