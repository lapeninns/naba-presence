import { clientCapabilityHeaders } from "@/lib/contracts/client-capabilities"

import { apiFetch, type RequestOptions } from "./client"

// The schema loads on demand (see `ResponseSchema` in ./client): the shell
// polls this on every page, and the contract pulls in zod.
export type { ShellStatusResponse } from "@/lib/contracts/shell-status"

export function fetchShellStatus(options?: RequestOptions) {
  return apiFetch("/api/shell-status", {
    schema: () =>
      import("@/lib/contracts/shell-status").then(
        (m) => m.shellStatusResponseSchema
      ),
    headers: clientCapabilityHeaders(),
    ...options,
  })
}
