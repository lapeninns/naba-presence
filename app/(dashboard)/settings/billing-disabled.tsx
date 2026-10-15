import type { Metadata } from "next"

import { NotFoundContent } from "@/components/app-shell/not-found-content"
import { getServerEnv } from "@/lib/server/env"

/**
 * The switch for the Billing and Usage routes (plan P07-S6), kept in one
 * place so every one of them answers a disabled deployment the same way:
 * the shared dashboard 404, drawn by the page itself instead of thrown
 * with `notFound()`.
 *
 * The dashboard's `loading.tsx` means a page is already streaming when it
 * runs, so a `notFound()` there makes React discard the streamed subtree
 * and draw the boundary only after the client has hydrated: on a phone the
 * "This page doesn't exist" content arrived about two seconds after the
 * skeleton (MEA-02). Returning the content is part of the streamed HTML.
 * The response is a 200 either way (the status is sent with the skeleton);
 * what `notFound()` added, the noindex tag, `billingRouteMetadata` keeps.
 */
export function billingRoutesEnabled(): boolean {
  return getServerEnv().BILLING_ENABLED
}

/** The page's metadata: its own title while enabled, the 404's while not. */
export function billingRouteMetadata(title: string): Metadata {
  return billingRoutesEnabled()
    ? { title }
    : {
        title: "Page not found · NabaPresence",
        robots: { index: false, follow: false },
      }
}

/** What a Billing or Usage route renders while billing is off. */
export function BillingRouteDisabled() {
  return <NotFoundContent />
}
