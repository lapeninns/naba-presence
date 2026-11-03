"use client"

import * as React from "react"

import { Pagination } from "@/components/ui/pagination"

const LISTINGS = ["listing", "listings"] as const

/**
 * The paged-table footer in both forms: two pages (Previous and Next only)
 * and a long desk table, where page numbers appear from `md`.
 */
export function PaginationDemo() {
  const [short, setShort] = React.useState(1)
  const [long, setLong] = React.useState(7)
  const total = 238
  const perPage = 6
  const longCount = Math.ceil(total / perPage)
  return (
    <div className="flex flex-col gap-4">
      <Pagination
        shown={short === 1 ? 5 : 4}
        total={9}
        noun={LISTINGS}
        sortLabel="name"
        page={short}
        pageCount={2}
        onPageChange={setShort}
      />
      <Pagination
        shown={long === longCount ? total - perPage * (longCount - 1) : perPage}
        total={total}
        noun={LISTINGS}
        sortLabel="most views"
        page={long}
        pageCount={longCount}
        onPageChange={setLong}
        pageNumbers
      />
    </div>
  )
}
