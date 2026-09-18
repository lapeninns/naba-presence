import { describe, expect, it } from "vitest"

import {
  inputToTimeOfDay,
  lodgingUpdatedPaths,
  timeOfDayToInput,
} from "@/lib/locations/forms/industry"
import {
  jobForSegment,
  LOCATION_JOBS,
  segmentHref,
  visibleLocationJobs,
} from "@/lib/locations/location-ia"

describe("lodging form helpers", () => {
  it("round-trips TimeOfDay for policy inputs", () => {
    expect(timeOfDayToInput({ hours: 15, minutes: 30 })).toBe("15:30")
    expect(timeOfDayToInput("9:05")).toBe("09:05")
    expect(inputToTimeOfDay("14:00")).toEqual({
      hours: 14,
      minutes: 0,
      seconds: 0,
      nanos: 0,
    })
  })

  it("reads lodgingUpdated diff masks in both shapes", () => {
    expect(lodgingUpdatedPaths({ diffMask: "policies,pets" })).toEqual([
      "policies",
      "pets",
    ])
    expect(
      lodgingUpdatedPaths({ diffMask: { paths: ["connectivity"] } })
    ).toEqual(["connectivity"])
  })
})

describe("location IA", () => {
  it("offers three jobs, opening on the Listing", () => {
    const jobs = visibleLocationJobs(true)
    expect(jobs.map((job) => job.id)).toEqual(["listing", "content", "access"])
    expect(jobs[0]).toMatchObject({ label: "Listing", segment: "" })
    // The Listing is one scroll: its parts are anchors, not routes.
    expect(jobs[0].views).toEqual([])
    expect(jobs[0].anchors.map((anchor) => anchor.id)).toEqual([
      "profile",
      "hours",
      "booking",
      "suggestions",
    ])
  })

  it("keeps Content and Access sub-views as routes under a segmented control", () => {
    const [, content, access] = visibleLocationJobs(true)
    expect(content.views.map((view) => view.segment)).toEqual([
      "photos",
      "posts",
      "menu",
    ])
    expect(content.segment).toBe("photos")
    expect(access.views.map((view) => view.segment)).toEqual([
      "access",
      "verification",
    ])
  })

  it("has no Performance job: that is a report, on Reports", () => {
    const segments = LOCATION_JOBS.flatMap((job) => [
      job.segment,
      ...job.views.map((view) => view.segment),
    ])
    expect(segments).not.toContain("performance")
  })

  it("hides the console job from members", () => {
    expect(visibleLocationJobs(false).map((job) => job.id)).toEqual([
      "listing",
      "content",
    ])
  })

  it("resolves a path segment to its job", () => {
    expect(jobForSegment("")?.id).toBe("listing")
    expect(jobForSegment("posts")?.id).toBe("content")
    expect(jobForSegment("verification")?.id).toBe("access")
    expect(jobForSegment("performance")).toBeUndefined()
    expect(segmentHref("loc-1", "")).toBe("/locations/loc-1")
    expect(segmentHref("loc-1", "menu")).toBe("/locations/loc-1/menu")
  })
})
