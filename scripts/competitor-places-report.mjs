import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import nextEnv from "@next/env"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const { loadEnvConfig } = nextEnv
loadEnvConfig(root)

const apiKey = process.env.GOOGLE_PLACES_API_KEY

if (!apiKey) {
  throw new Error("GOOGLE_PLACES_API_KEY is required")
}

if (!/^AIza[A-Za-z0-9_-]{35}$/.test(apiKey)) {
  throw new Error(
    `GOOGLE_PLACES_API_KEY must be a 39-character AIza key (length=${apiKey.length}, prefix=${apiKey.slice(0, 4)})`
  )
}

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
const SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount"
const LEGACY_DETAILS_URL =
  "https://maps.googleapis.com/maps/api/place/details/json"
const LEGACY_DETAILS_FIELDS =
  "place_id,name,formatted_address,rating,user_ratings_total,business_status,reviews,current_opening_hours/open_now"
const REQUEST_TIMEOUT_MS = 15_000
const MAX_DETAIL_ATTEMPTS = 2
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

const venues = [
  {
    name: "The George",
    area: "Girton",
    streetNumber: "71",
    postcode: "CB3 0QD",
    address: "71 High Street, Girton, Cambridge CB3 0QD",
  },
  {
    name: "The Barley Mow",
    area: "Histon",
    streetNumber: "7",
    postcode: "CB24 9JD",
    address: "7 High Street, Histon, Cambridge CB24 9JD",
  },
  {
    name: "The Red Lion",
    area: "Histon",
    streetNumber: "27",
    postcode: "CB24 9JD",
    address: "27 High Street, Histon, Cambridge CB24 9JD",
  },
  {
    name: "The Boot Inn",
    area: "Histon",
    streetNumber: "1",
    postcode: "CB24 9LG",
    address: "1 High Street, Histon, Cambridge CB24 9LG",
  },
  {
    name: "King William IV",
    area: "Histon",
    streetNumber: "8",
    postcode: "CB24 9EP",
    address: "8 Church Street, Histon, Cambridge CB24 9EP",
  },
  {
    name: "Tawa Lounge",
    area: "Histon",
    streetNumber: "20",
    postcode: "CB24 9JA",
    address: "20 The Green, Histon, Cambridge CB24 9JA",
  },
  {
    name: "Railway Vue",
    area: "Impington",
    streetNumber: "163",
    postcode: "CB24 9NP",
    address: "163 Station Road, Impington, Cambridge CB24 9NP",
  },
  {
    name: "Rose & Crown",
    area: "Impington",
    streetNumber: "2",
    postcode: "CB24 9JB",
    address: "2 Glebe Way, Impington, Cambridge CB24 9JB",
  },
  {
    name: "White Horse",
    area: "Oakington",
    streetNumber: "28",
    postcode: "CB24 3AB",
    address: "28 Longstanton Road, Oakington, Cambridge CB24 3AB",
  },
]

const baseline = {
  name: "The Old Crown Girton",
  area: "Girton",
  streetNumber: "89",
  postcode: "CB3 0QD",
  address: "89 High Street, Girton, Cambridge CB3 0QD",
}

function normalisePostcode(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function matchesPostcode(address, postcode) {
  return normalisePostcode(address).includes(normalisePostcode(postcode))
}

function matchesStreetNumber(address, streetNumber) {
  const escaped = streetNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?:^|\\D)${escaped}(?:[A-Za-z])?(?=\\D|$)`).test(address)
}

function addressMatch(place, venue) {
  const formattedAddress = place.formattedAddress ?? ""
  const postcodeMatches = matchesPostcode(formattedAddress, venue.postcode)
  const streetNumberMatches = matchesStreetNumber(
    formattedAddress,
    venue.streetNumber
  )
  return {
    formattedAddress,
    postcodeMatches,
    streetNumberMatches,
    exact: postcodeMatches && streetNumberMatches,
  }
}

function resolvePlace(venue, places) {
  const exact = places.find((place) => addressMatch(place, venue).exact)
  const streetNumberOnly = places.find(
    (place) => addressMatch(place, venue).streetNumberMatches
  )
  const selected = exact ?? streetNumberOnly ?? null

  if (!places.length) {
    return {
      place: null,
      status: "zero-results",
      address: null,
    }
  }

  if (!selected) {
    return {
      place: null,
      status: "no-street-number-match",
      address: null,
    }
  }

  const address = addressMatch(selected, venue)
  return {
    place: selected,
    status: address.exact ? "exact" : "postcode-mismatch",
    address,
  }
}

function errorMessage(payload, fallback) {
  return payload?.error?.message ?? fallback
}

async function requestJson(url, options, attempts) {
  let lastError = "request failed"

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const text = await response.text()
      let payload = null

      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = null
      }

      if (response.ok) {
        return { ok: true, payload, status: response.status, attempts: attempt }
      }

      lastError = errorMessage(payload, text || response.statusText)
      const retryable =
        attempt < attempts &&
        (response.status === 408 ||
          response.status === 429 ||
          response.status >= 500)

      if (!retryable) break
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      if (attempt === attempts) break
    }
  }

  return { ok: false, error: lastError, attempts }
}

function apiHeaders(fieldMask) {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": fieldMask,
  }
}

async function searchVenue(venue) {
  const result = await requestJson(
    SEARCH_URL,
    {
      method: "POST",
      headers: apiHeaders(SEARCH_FIELD_MASK),
      body: JSON.stringify({
        textQuery: `${venue.name}, ${venue.address}`,
      }),
    },
    1
  )

  if (!result.ok) {
    return {
      venue,
      search: result,
      places: [],
      resolution: { place: null, status: "search-failed", address: null },
    }
  }

  const places = Array.isArray(result.payload?.places)
    ? result.payload.places
    : []
  return {
    venue,
    search: result,
    places,
    resolution: resolvePlace(venue, places),
  }
}

async function fetchDetails(placeId) {
  const url = new URL(LEGACY_DETAILS_URL)
  url.searchParams.set("place_id", placeId)
  url.searchParams.set("fields", LEGACY_DETAILS_FIELDS)
  url.searchParams.set("reviews_sort", "newest")
  url.searchParams.set("key", apiKey)

  const result = await requestJson(
    url,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
    MAX_DETAIL_ATTEMPTS
  )

  if (!result.ok) return result
  if (result.payload?.status !== "OK") {
    return {
      ...result,
      ok: false,
      error:
        result.payload?.error_message ??
        result.payload?.status ??
        "Legacy Place Details returned an unsuccessful status",
    }
  }
  return result
}

function reviewPublishTimestamp(review) {
  const publishTime = review.publishTime
    ? review.publishTime
    : Number.isFinite(Number(review.time))
      ? new Date(Number(review.time) * 1000).toISOString()
      : null
  const timestamp = publishTime ? Date.parse(publishTime) : NaN
  return Number.isFinite(timestamp) ? timestamp : null
}

function reviewWithinThirtyDays(review, now, cutoff) {
  const timestamp = reviewPublishTimestamp(review)
  if (timestamp === null) return null
  return timestamp >= cutoff.getTime() && timestamp <= now.getTime()
}

function reviewText(review) {
  return (
    review.text?.text ??
    review.originalText?.text ??
    review.text ??
    "(No review text returned.)"
  )
}

function formatNumber(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat("en-GB").format(value)
    : "—"
}

function formatRating(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "—"
}

function formatDate(value) {
  return value ? value : "not supplied"
}

function formatAddressWarning(record) {
  if (record.resolution.status === "zero-results") {
    return "WARNING: zero search results; the venue may be permanently closed."
  }
  if (record.resolution.status === "search-failed") {
    return `WARNING: search failed: ${record.search.error}`
  }
  if (record.resolution.status === "no-street-number-match") {
    return "WARNING: no returned formattedAddress matched the expected street number; the venue was not resolved by name alone."
  }
  if (record.resolution.status === "postcode-mismatch") {
    return `WARNING: returned postcode does not match expected ${record.venue.postcode}.`
  }
  return "Address check: exact postcode + street-number match."
}

function recordFromSearch(searchRecord, detailsResult = null) {
  const place = searchRecord.resolution.place
  const details = detailsResult?.ok ? detailsResult.payload?.result : null
  const reviews = Array.isArray(details?.reviews) ? details.reviews : []
  const now = new Date()
  const cutoff = new Date(now.getTime() - THIRTY_DAYS_MS)
  const reviewsWithinThirtyDays = reviews.filter(
    (review) => reviewWithinThirtyDays(review, now, cutoff) === true
  ).length

  return {
    ...searchRecord,
    placeId: details?.place_id ?? place?.id ?? null,
    displayName: details?.name ?? place?.displayName?.text ?? null,
    formattedAddress:
      details?.formatted_address ?? place?.formattedAddress ?? null,
    rating: details?.rating ?? place?.rating ?? null,
    userRatingCount:
      details?.user_ratings_total ?? place?.userRatingCount ?? null,
    businessStatus: details?.business_status ?? null,
    openNow: details?.current_opening_hours?.open_now ?? null,
    reviews,
    reviewsWithinThirtyDays,
    detailsResult,
    reportNow: now,
    reportCutoff: cutoff,
  }
}

async function collectVenue(venue) {
  const searchRecord = await searchVenue(venue)
  if (!searchRecord.resolution.place?.id) {
    return recordFromSearch(searchRecord)
  }

  const detailsResult = await fetchDetails(searchRecord.resolution.place.id)
  return recordFromSearch(searchRecord, detailsResult)
}

function collectBaseline(searchRecord) {
  return recordFromSearch(searchRecord)
}

function displayOpenNow(value) {
  if (value === true) return "yes"
  if (value === false) return "no"
  return "not supplied"
}

function printTable(records) {
  console.log(
    "| venue | area | rating | review count | business status | reviews returned | # within 30 days |"
  )
  console.log("| --- | --- | ---: | ---: | --- | ---: | ---: |")
  for (const record of records) {
    console.log(
      `| ${record.venue.name} | ${record.venue.area} | ${formatRating(record.rating)} | ${formatNumber(record.userRatingCount)} | ${record.businessStatus ?? "—"} | ${record.reviews.length} | ${record.reviewsWithinThirtyDays} |`
    )
  }
}

function printResolution(records) {
  console.log("## Place resolution and detail checks")
  for (const record of records) {
    console.log(`### ${record.venue.name}`)
    console.log(`- Place ID: ${record.placeId ?? "not resolved"}`)
    console.log(`- Google name: ${record.displayName ?? "not supplied"}`)
    console.log(
      `- Returned address: ${record.formattedAddress ?? "not supplied"}`
    )
    console.log(`- ${formatAddressWarning(record)}`)
    if (record.detailsResult && !record.detailsResult.ok) {
      console.log(
        `- WARNING: detail request failed after ${record.detailsResult.attempts} attempt(s): ${record.detailsResult.error}`
      )
    }
    console.log(`- Open now: ${displayOpenNow(record.openNow)}`)
    console.log("")
  }
}

function printReviews(records) {
  console.log("## Reviews within the last 30 days (Legacy newest order)")
  for (const record of records) {
    const recentReviews = record.reviews.filter(
      (review) =>
        reviewWithinThirtyDays(
          review,
          record.reportNow,
          record.reportCutoff
        ) === true
    )
    console.log(
      `### ${record.venue.name} (${recentReviews.length} within 30 days)`
    )
    if (!recentReviews.length) {
      console.log(
        "No returned Legacy review was published within the last 30 days."
      )
      console.log("")
      continue
    }

    for (const [index, review] of recentReviews.entries()) {
      console.log(
        `${index + 1}. ${review.rating ?? "?"}/5 | ${review.relativePublishTimeDescription ?? review.relative_time_description ?? "relative age not supplied"} | publishTime: ${formatDate(review.publishTime ?? (Number.isFinite(Number(review.time)) ? new Date(Number(review.time) * 1000).toISOString() : null))} | within 30 days: yes`
      )
      for (const line of reviewText(review).split(/\r?\n/)) {
        console.log(`   > ${line}`)
      }
      console.log("")
    }
  }
}

function printBaselineSummary(records, baselineRecord) {
  console.log("## Summary")
  if (!baselineRecord.placeId || !Number.isFinite(baselineRecord.rating)) {
    console.log(
      `The Old Crown Girton baseline could not be resolved with a rating. ${formatAddressWarning(baselineRecord)}`
    )
    return
  }

  const above = records.filter(
    (record) =>
      Number.isFinite(record.rating) && record.rating > baselineRecord.rating
  )
  const below = records.filter(
    (record) =>
      Number.isFinite(record.rating) && record.rating < baselineRecord.rating
  )
  const equal = records.filter(
    (record) =>
      Number.isFinite(record.rating) && record.rating === baselineRecord.rating
  )
  const rankedByReviewCount = records
    .filter((record) => Number.isFinite(record.userRatingCount))
    .sort((left, right) => right.userRatingCount - left.userRatingCount)
    .slice(0, 3)

  console.log(
    `The Old Crown Girton baseline: ${formatRating(baselineRecord.rating)} stars from ${formatNumber(baselineRecord.userRatingCount)} reviews (${baselineRecord.formattedAddress ?? "address not supplied"}).`
  )
  console.log(
    `Rated above the baseline: ${above.length ? above.map((record) => `${record.venue.name} (${formatRating(record.rating)})`).join(", ") : "none"}.`
  )
  console.log(
    `Rated below the baseline: ${below.length ? below.map((record) => `${record.venue.name} (${formatRating(record.rating)})`).join(", ") : "none"}.`
  )
  if (equal.length) {
    console.log(
      `Rated the same as the baseline: ${equal.map((record) => `${record.venue.name} (${formatRating(record.rating)})`).join(", ")}.`
    )
  }
  console.log(
    `Most review volume among the nine competitors: ${rankedByReviewCount.length ? rankedByReviewCount.map((record) => `${record.venue.name} (${formatNumber(record.userRatingCount)})`).join(", ") : "not available"}.`
  )
}

const competitorRecords = []
for (const venue of venues) {
  competitorRecords.push(await collectVenue(venue))
}

const baselineRecord = collectBaseline(await searchVenue(baseline))

console.log("# Cambridge competitor review and rating report")
console.log(`Generated: ${new Date().toISOString()}`)
console.log("")
console.log("## Ratings and review volume")
printTable(competitorRecords)
console.log("")
printResolution(competitorRecords)
printReviews(competitorRecords)
printBaselineSummary(competitorRecords, baselineRecord)
console.log("")
console.log("## API and terms limitations")
console.log(
  "Place IDs are resolved with Places API (New) Text Search; review details are fetched with official Places API (Legacy) Place Details using reviews_sort=newest."
)
console.log(
  "Legacy returns at most 5 reviews per place. It provides native newest ordering, but no review pagination or date filter, so the within-30-days count is still not a complete 30-day competitor feed."
)
console.log(
  `Reviews request the Enterprise + Atmosphere SKU; each venue detail request was capped at ${MAX_DETAIL_ATTEMPTS} attempts and no third-party scraper was used.`
)
console.log(
  "Google Maps Platform terms prohibit caching this review content; this script prints it for the report and does not persist it to the database."
)
