"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useClients } from "@/lib/queries/use-clients"

const ALL = "__all__"

/**
 * Which client a report covers.
 *
 * Reports were organisation-wide only, which for an agency means every number
 * is an average across businesses that have nothing to do with each other.
 * The one number an account manager needs is their client's.
 */
export function ClientSelect({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (clientId: string | undefined) => void
}) {
  const clients = useClients()
  const items = clients.data?.items ?? []
  if (items.length === 0) return null

  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) =>
        onChange(next && next !== ALL ? next : undefined)
      }
    >
      <SelectTrigger className="w-full sm:w-56" aria-label="Client">
        <SelectValue>
          {(selected: string | null) =>
            selected && selected !== ALL
              ? (items.find((client) => client.id === selected)?.name ??
                "All clients")
              : "All clients"
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All clients</SelectItem>
        {items.map((client) => (
          <SelectItem key={client.id} value={client.id}>
            {client.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
