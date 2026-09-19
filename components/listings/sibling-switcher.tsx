"use client"

import { usePathname } from "next/navigation"

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
} from "@/components/ui/combobox"
import {
  useLocationDirectory,
  type DirectoryEntry,
} from "@/lib/queries/use-locations"

/**
 * Jump to another listing of the same client, keeping the area open.
 *
 * Siblings only. Switching between two clients' listings from one control
 * invites publishing to the wrong business; to change client you go through
 * the client, which is also where the breadcrumb points. Nothing for a
 * client with one listing.
 */
function SiblingSwitcher({
  current,
  role,
}: {
  current: DirectoryEntry
  role: string | null
}) {
  const pathname = usePathname()
  const directory = useLocationDirectory(role)
  const siblings = (directory.data ?? []).filter(
    (entry) => entry.clientId === current.clientId
  )
  if (siblings.length < 2) return null
  const base = `/listings/${current.id}`
  const suffix = pathname.startsWith(base) ? pathname.slice(base.length) : ""

  return (
    <Combobox
      items={siblings}
      itemToStringLabel={(entry: DirectoryEntry) => entry.name}
      value={current}
      onValueChange={(next: DirectoryEntry | null) => {
        if (next && next.id !== current.id)
          window.location.assign(`/listings/${next.id}${suffix}`)
      }}
    >
      <ComboboxInput
        placeholder="Switch listing"
        aria-label="Switch to another listing of this client"
        wrapperClassName="w-56"
        className="h-(--np-control-h)"
      />
      <ComboboxContent>
        {siblings.map((entry) => (
          <ComboboxItem key={entry.id} value={entry}>
            {entry.name}
          </ComboboxItem>
        ))}
      </ComboboxContent>
    </Combobox>
  )
}

export { SiblingSwitcher }
