"use client"

import { useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { fetchOnboardingCategories } from "@/lib/api/google-onboarding-categories"
import { onboardingCategoryQuerySchema } from "@/lib/contracts/google-onboarding-categories"
import type { GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"
import { categoryLabel } from "@/lib/locations/console-labels"
import { describeActionError } from "@/lib/errors/action-errors"

type Categories = GoogleOnboardingDraft["payload"]["categories"]

export function OnboardingCategories({
  draft,
  regionCode,
  languageCode,
  value,
  onChange,
}: {
  draft: GoogleOnboardingDraft
  regionCode: string
  languageCode: string
  value: Categories
  onChange: (value: Categories) => void
}) {
  const [query, setQuery] = useState("")
  const [searched, setSearched] = useState("")
  const input = onboardingCategoryQuerySchema.safeParse({
    connectionId: draft.connectionId,
    clientId: draft.clientId ?? undefined,
    regionCode,
    languageCode,
    query: searched,
  })
  const results = useInfiniteQuery({
    queryKey: [
      "onboarding-categories",
      draft.accountId,
      draft.connectionId,
      draft.clientId,
      regionCode,
      languageCode,
      searched,
    ],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      fetchOnboardingCategories(
        draft.accountId,
        onboardingCategoryQuerySchema.parse({
          connectionId: draft.connectionId,
          clientId: draft.clientId ?? undefined,
          regionCode,
          languageCode,
          query: searched,
          pageToken: pageParam || undefined,
        }),
        { signal }
      ),
    getNextPageParam: (page) => page.nextPageToken || undefined,
    enabled: input.success,
    retry: false,
  })
  const categories = [
    ...new Map(
      (results.data?.pages.flatMap((page) => page.categories) ?? []).map(
        (category) => [category.name, category]
      )
    ).values(),
  ]
  const label = (name: string) =>
    categoryLabel(
      categories.find((category) => category.name === name) ?? { name }
    )
  const additional = value?.additionalCategories ?? []
  const search = () => {
    const next = query.trim()
    if (
      !onboardingCategoryQuerySchema.safeParse({
        connectionId: draft.connectionId,
        regionCode,
        languageCode,
        query: next,
      }).success
    )
      return
    if (next === searched) void results.refetch()
    else setSearched(next)
  }
  return (
    <div
      className="flex min-w-0 flex-col gap-3 sm:col-span-2"
      role="group"
      aria-label="Business categories"
    >
      <div className="space-y-1">
        <h5 className="text-ui font-semibold">Business categories</h5>
        <p className="text-caption text-ink-muted">
          Choose the primary category that describes the business as a whole,
          then up to nine additional categories. Categories are saved with your
          draft.
        </p>
      </div>
      {value ? (
        <div className="space-y-2 rounded-(--np-radius-card) border border-line p-4">
          <p className="text-ui break-words">
            <strong>Primary:</strong> {label(value.primaryCategory.name)}
          </p>
          {additional.length > 0 && (
            <ul className="space-y-2">
              {additional.map((category) => (
                <li
                  key={category.name}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="text-ui break-words">
                    {label(category.name)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      onChange({
                        ...value,
                        additionalCategories: additional.filter(
                          (item) => item.name !== category.name
                        ),
                      })
                    }
                  >
                    Remove
                    <span className="sr-only"> {label(category.name)}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
            Clear selected categories
          </Button>
        </div>
      ) : (
        <p className="text-ui text-ink-muted">No primary category selected.</p>
      )}
      <Field>
        <FieldLabel>Search Google categories</FieldLabel>
        <Input
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              search()
            }
          }}
        />
        <FieldDescription>
          Search the start of a category name. Results use{" "}
          {regionCode || "the country code"} and{" "}
          {languageCode || "the listing language"}.
        </FieldDescription>
      </Field>
      <Button
        className="self-start"
        variant="secondary"
        pending={results.isFetching && !results.isFetchingNextPage}
        pendingLabel="Searching categories…"
        disabled={
          !onboardingCategoryQuerySchema.safeParse({
            connectionId: draft.connectionId,
            regionCode,
            languageCode,
            query,
          }).success
        }
        onClick={search}
      >
        Find categories
      </Button>
      {searched && !input.success && (
        <p role="alert" className="text-ui text-danger-ink">
          Enter a valid country code and listing language before searching
          categories.
        </p>
      )}
      {input.success && results.isError && (
        <p role="alert" className="text-ui text-danger-ink">
          {describeActionError(results.error)} Use Find categories to retry.
        </p>
      )}
      {input.success && results.isSuccess && (
        <>
          <p role="status" className="text-caption text-ink-muted">
            {categories.length
              ? `${categories.length} categories loaded.`
              : "Google returned no categories for this search. Try another category name."}
          </p>
          <ul className="divide-y divide-line rounded-(--np-radius-card) border border-line">
            {categories.map((category) => (
              <li
                key={category.name}
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <span className="min-w-0 text-ui font-medium break-words">
                  {category.displayName}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={value?.primaryCategory.name === category.name}
                    onClick={() =>
                      onChange({
                        primaryCategory: { name: category.name },
                        additionalCategories: additional.filter(
                          (item) => item.name !== category.name
                        ),
                      })
                    }
                  >
                    Set primary
                    <span className="sr-only">: {category.displayName}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      !value ||
                      additional.length >= 9 ||
                      value.primaryCategory.name === category.name ||
                      additional.some((item) => item.name === category.name)
                    }
                    onClick={() => {
                      if (value)
                        onChange({
                          ...value,
                          additionalCategories: [
                            ...additional,
                            { name: category.name },
                          ],
                        })
                    }}
                  >
                    Add category
                    <span className="sr-only">: {category.displayName}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {results.hasNextPage && (
            <Button
              variant="secondary"
              className="self-start"
              pending={results.isFetchingNextPage}
              pendingLabel="Loading categories…"
              onClick={() => void results.fetchNextPage()}
            >
              Load more categories
            </Button>
          )}
        </>
      )}
    </div>
  )
}
