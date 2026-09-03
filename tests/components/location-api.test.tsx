import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchLocationCapabilities, fetchManagementLocations } from "@/lib/api/locations"
import { saveHours } from "@/lib/api/location-hours"
import { fetchMedia, uploadMediaFile } from "@/lib/api/location-media"
import { publishPost, updatePost } from "@/lib/api/location-posts"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("locations directory + capabilities clients", () => {
  it("fetchManagementLocations requests the management view and maps rows", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ locations: [{ locationId: "loc-1", name: "Riverside", address: { locality: "Bath" }, timezone: "Europe/London", linkId: "ll-1", externalLocationId: "e-1", googleLocationName: "locations/1", googleTitle: "Riverside", verified: true, clientId: null, clientName: null }] })
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await fetchManagementLocations()
    expect(result.locations[0].verified).toBe(true)
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.pathname).toBe("/api/location-links")
    expect(url.searchParams.get("view")).toBe("management")
  })

  it("fetchLocationCapabilities parses the capability envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ capabilities: { canEditCanonical: false, canPublish: true } })))
    expect(await fetchLocationCapabilities("loc-1")).toEqual({
      canEditCanonical: false,
      canPublish: true,
    })
  })
})

describe("tab mutation clients", () => {
  it("defaults an uncategorised Google customer photo to Additional", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      media: {
        canPublish: true,
        writesEnabled: false,
        categories: ["ADDITIONAL"],
        items: [{
          id: "m1",
          googleMediaName: "accounts/a/locations/l/media/customers/1",
          ownership: "customer",
          mediaFormat: "PHOTO",
          category: null,
          sourceUrl: null,
          googleUrl: "https://google.example/customer.jpg",
          thumbnailUrl: "https://google.example/customer-thumb.jpg",
          description: null,
          attribution: null,
          dimensions: null,
          insights: null,
          googleHash: "hash",
          createTime: "2026-08-04T09:00:00.000Z",
        }],
        total: 1,
        page: 1,
        pageSize: 12,
      },
    })))

    const media = await fetchMedia("loc-1")

    expect(media.items[0]?.category).toBe("ADDITIONAL")
  })

  it("fetchMedia forwards category and ownership filters", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        media: {
          canPublish: true,
          writesEnabled: true,
          categories: ["INTERIOR"],
          items: [],
          total: 0,
          page: 2,
          pageSize: 12,
          category: "INTERIOR",
          ownership: "merchant",
        },
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    await fetchMedia("loc-1", {
      page: 2,
      pageSize: 12,
      category: "INTERIOR",
      ownership: "merchant",
    })

    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.pathname).toBe("/api/locations/loc-1/media")
    expect(url.searchParams.get("page")).toBe("2")
    expect(url.searchParams.get("pageSize")).toBe("12")
    expect(url.searchParams.get("category")).toBe("INTERIOR")
    expect(url.searchParams.get("ownership")).toBe("merchant")
  })

  it("saveHours PUTs the revision and hours", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ saved: true, revision: "3" }))
    vi.stubGlobal("fetch", fetchMock)
    const hours = { regular: [], special: [], moreHours: [] }
    const result = await saveHours("loc-1", { expectedCanonicalRevision: "2", hours: hours as never })
    expect(result.revision).toBe("3")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/locations/loc-1/hours")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PUT")
  })

  it("uploadMediaFile POSTs multipart form data via XHR and reports progress", async () => {
    const opened: Array<[string, string]> = []
    const sent: unknown[] = []
    const setHeader = vi.fn()
    class MockXHR {
      status = 201
      responseText = JSON.stringify({ id: "m1", status: "succeeded", idempotent: false })
      upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      open(method: string, url: string) {
        opened.push([method, url])
      }
      setRequestHeader(...args: [string, string]) {
        setHeader(...args)
      }
      send(body: unknown) {
        sent.push(body)
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 })
        this.onload?.()
      }
    }
    vi.stubGlobal("XMLHttpRequest", MockXHR as unknown as typeof XMLHttpRequest)
    const form = new FormData()
    form.set("mediaFormat", "PHOTO")
    const progress: number[] = []
    const result = await uploadMediaFile("loc-1", form, (fraction) => progress.push(fraction))
    expect(result.status).toBe("succeeded")
    expect(opened[0]).toEqual(["POST", "/api/locations/loc-1/media"])
    expect(sent[0]).toBeInstanceOf(FormData)
    // Never sets content-type; the browser adds the multipart boundary.
    expect(setHeader).not.toHaveBeenCalled()
    expect(progress).toContain(0.5)
  })

  it("publishPost surfaces the awaiting-approval status (202)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "awaiting_approval" }, 202)))
    expect((await publishPost("loc-1", "p1")).status).toBe("awaiting_approval")
  })

  it("publishPost surfaces the second-approver error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ error: "second_approver_required", message: "A different authorised user must approve this post." }, 403)
    ))
    await expect(publishPost("loc-1", "p1")).rejects.toMatchObject({ code: "second_approver_required", status: 403 })
  })

  const localPostInput = { topicType: "STANDARD" as const, languageCode: "en-GB", summary: "Open late tonight", media: [] }

  it("updatePost parses the { post } shape for a plain draft edit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ post: { id: "p1", status: "draft" } })))
    const result = await updatePost("loc-1", "p1", localPostInput)
    expect(result).toEqual({ post: { id: "p1", status: "draft" } })
  })

  it("updatePost parses the republish outcome when editing an already-published post", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "published", postId: "p1", googlePostName: "accounts/1/locations/2/localPosts/3" })))
    const result = await updatePost("loc-1", "p1", localPostInput)
    expect(result).toEqual({ status: "published", postId: "p1", googlePostName: "accounts/1/locations/2/localPosts/3" })
  })
})
