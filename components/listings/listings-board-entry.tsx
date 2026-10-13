"use client"

import dynamic from "next/dynamic"

/**
 * The listings page's reference to the board, through next/dynamic.
 *
 * Next merges a parent route's client reference manifest into every child
 * route's, so whatever `/listings` references statically is counted, and
 * named, on every `/listings/[id]/*` and `/listings/bulk/*` page as well:
 * with the board referenced directly, that was its page chunk and four split
 * chunks (about 44 KB gzip) on each listing page. Loaded through here, the
 * board is an async chunk. It still renders on the server (ssr stays on),
 * and `/listings` preloads its chunk with the HTML, so the page looks and
 * behaves the same.
 */
export const ListingsBoard = dynamic(() =>
  import("./listings-board").then((m) => m.ListingsBoard)
)
