/**
 * Rewrite this page's address without asking the server for anything.
 *
 * Next patches `history.pushState` / `replaceState`: `useSearchParams` and
 * `usePathname` follow the new address, and the router restores the tree it
 * already holds, so no RSC request is made and the page's server component
 * does not run again ("Native History API",
 * node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md).
 * `router.replace` to the same page with a new query string re-ran the page
 * on the server every time, and its hydration of a fresher first page threw
 * away every later page the list had loaded.
 *
 * For state that lives in the query string and is read on the client. A
 * first load (or a reload) still renders from the address on the server.
 * The state argument is `null`: Next copies its own router state onto the
 * entry, and the leave guard keeps its markers on a same-address rewrite.
 */
export function replaceUrl(href: string) {
  window.history.replaceState(null, "", href)
}

/** As `replaceUrl`, on a new history entry, so Back returns to this one. */
export function pushUrl(href: string) {
  window.history.pushState(null, "", href)
}
