"use client"

import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ClientSummary } from "@/lib/contracts/clients"

const ALL = "__all__"

/**
 * Which client a report covers (reference scope `Client` field).
 *
 * Reports were organisation-wide only, which for an agency means every number
 * is an average across businesses that have nothing to do with each other.
 * The one number an account manager needs is their client's.
 */
export function ClientSelect({
  clients,
  value,
  onChange,
}: {
  clients: ClientSummary[]
  value: string | undefined
  onChange: (clientId: string | undefined) => void
}) {
  if (clients.length === 0) return null

  return (
    <Field className="min-w-44 flex-[1_1_11rem] sm:flex-none">
      <FieldLabel>Client</FieldLabel>
      <Select
        value={value ?? ALL}
        onValueChange={(next) =>
          onChange(next && next !== ALL ? next : undefined)
        }
      >
        <SelectTrigger className="w-full sm:w-56">
          <SelectValue>
            {(selected: string | null) =>
              selected && selected !== ALL
                ? (clients.find((client) => client.id === selected)?.name ??
                  "All clients")
                : "All clients"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All clients</SelectItem>
          {clients.map((client) => (
            <SelectItem key={client.id} value={client.id}>
              {client.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
