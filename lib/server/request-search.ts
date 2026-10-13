import "server-only"

import { headers } from "next/headers"

import { REQUEST_PATH_HEADER } from "@/lib/api/next-path"

/**
 * The query string this request was made with, from the header proxy.ts sets
 * (path + search). Empty when the header is missing, which only costs a
 * prefetch: a page's client view still reads its state from the URL.
 *
 * For pages that key a server prefetch on the URL without declaring a
 * `searchParams` prop (see app/(dashboard)/inbox/page.tsx for why).
 */
export async function requestSearch(): Promise<URLSearchParams> {
  const requested = (await headers()).get(REQUEST_PATH_HEADER)
  if (!requested) return new URLSearchParams()
  try {
    return new URL(requested, "https://placeholder.invalid").searchParams
  } catch {
    return new URLSearchParams()
  }
}
