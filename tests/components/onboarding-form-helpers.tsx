import { screen } from "@testing-library/react"
import type userEvent from "@testing-library/user-event"
import { useState, type ReactElement } from "react"

type User = ReturnType<typeof userEvent.setup>

/** Opens a select by its accessible name and chooses one option. */
export async function pick(
  user: User,
  select: string | RegExp,
  option: string
) {
  await user.click(screen.getByRole("combobox", { name: select }))
  await user.click(await screen.findByRole("option", { name: option }))
}

/**
 * Holds the value a controlled form hands back, so a test can drive it the way
 * the draft does: the form calls `onChange`, the parent keeps the value and
 * passes it down again. `seen` records every value handed back (including
 * `undefined` for "removed"), which is the payload the draft would store.
 */
export function Controlled<T>({
  initial,
  seen,
  children,
}: {
  initial: T
  seen: T[]
  children: (value: T, set: (next: T) => void) => ReactElement
}) {
  const [value, setValue] = useState(initial)
  return children(value, (next) => {
    seen.push(next)
    setValue(next)
  })
}
