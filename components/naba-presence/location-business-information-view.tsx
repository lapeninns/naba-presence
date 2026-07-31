"use client"

import { Search, Send, SlidersHorizontal } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { LiveDataError } from "@/components/naba-presence/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { BUSINESS_INFORMATION_UPDATE_MASKS } from "@/lib/domain/business-information"
import {
  type BusinessInformationState,
  loadBusinessInformation,
  searchBusinessInformationMetadata,
  updateBusinessAttributes,
  updateBusinessInformation,
} from "@/lib/naba-presence-api"

const EDITABLE_FIELDS = new Set<string>(BUSINESS_INFORMATION_UPDATE_MASKS)

function editableLocation(location: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(location).filter(([key]) => EDITABLE_FIELDS.has(key))
  )
}

function parseObject(value: string) {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Business Information must be a JSON object.")
  }
  return parsed as Record<string, unknown>
}

function parseArray(value: string) {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error("Attributes must be a JSON array.")
  return parsed as Array<Record<string, unknown>>
}

export function LocationBusinessInformationView({
  locationId,
}: {
  locationId: string
}) {
  const [state, setState] = useState<BusinessInformationState | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  )
  const [reloadKey, setReloadKey] = useState(0)
  const [locationJson, setLocationJson] = useState("{}")
  const [attributesJson, setAttributesJson] = useState("[]")
  const [updateMask, setUpdateMask] = useState<string[]>([])
  const [attributeMask, setAttributeMask] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [searchType, setSearchType] = useState<"categories" | "chains">(
    "categories"
  )
  const [query, setQuery] = useState("")
  const [searchResult, setSearchResult] = useState<Record<
    string,
    unknown
  > | null>(null)

  const refresh = useCallback(() => {
    setStatus("loading")
    setReloadKey((value) => value + 1)
  }, [])

  useEffect(() => {
    let active = true
    void loadBusinessInformation(locationId)
      .then(({ businessInformation }) => {
        if (!active) return
        setState(businessInformation)
        setLocationJson(
          JSON.stringify(
            editableLocation(businessInformation.location),
            null,
            2
          )
        )
        setAttributesJson(
          JSON.stringify(businessInformation.attributes.attributes ?? [], null, 2)
        )
        setUpdateMask([])
        setAttributeMask("")
        setConfirmed(false)
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [locationId, reloadKey])

  const canWrite = Boolean(
    state?.canPublish && state.writesEnabled && confirmed
  )
  const attributeGroups = useMemo(() => {
    const groups = new Map<string, Array<Record<string, unknown>>>()
    for (const item of state?.attributeMetadata ?? []) {
      const group = String(item.groupDisplayName ?? "Other")
      groups.set(group, [...(groups.get(group) ?? []), item])
    }
    return [...groups.entries()]
  }, [state?.attributeMetadata])

  async function publishLocation() {
    if (!state) return
    setBusy(true)
    setMessage(null)
    try {
      await updateBusinessInformation(locationId, {
        expectedGoogleHash: state.locationHash,
        updateMask,
        payload: parseObject(locationJson),
      })
      setMessage("Business Information validated, published, and read back from Google.")
      refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The update failed.")
    } finally {
      setBusy(false)
    }
  }

  async function publishAttributes() {
    if (!state) return
    setBusy(true)
    setMessage(null)
    try {
      await updateBusinessAttributes(locationId, {
        expectedGoogleHash: state.attributesHash,
        attributeMask: attributeMask
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        attributes: parseArray(attributesJson),
      })
      setMessage("Attributes published and read back from Google.")
      refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The update failed.")
    } finally {
      setBusy(false)
    }
  }

  async function runSearch() {
    if (!query.trim()) return
    setBusy(true)
    try {
      const { result } = await searchBusinessInformationMetadata(locationId, {
        type: searchType,
        query: query.trim(),
      })
      setSearchResult(result)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Search failed.")
    } finally {
      setBusy(false)
    }
  }

  if (status === "loading") {
    return <Skeleton className="h-[640px] w-full" />
  }
  if (status === "error" || !state) return <LiveDataError onRetry={refresh} />

  return (
    <section className="flex flex-col gap-(--nr-gap-section)">
      {!state.writesEnabled ? (
        <Alert>
          <SlidersHorizontal />
          <AlertTitle>Business Information writes are paused</AlertTitle>
          <AlertDescription>
            Live Google data remains visible. Publishing uses the profile-write
            and global publish controls.
          </AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert>
          <Send />
          <AlertTitle>Business Information status</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Complete Business Information</CardTitle>
          <CardDescription>
            Edit Google&apos;s supported fields: categories, phones, address,
            service area, services, labels, store code, open state, profile,
            website, and location or chain relationships.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="business-information-json">Approved payload</Label>
            <Textarea
              id="business-information-json"
              value={locationJson}
              onChange={(event) => setLocationJson(event.target.value)}
              className="min-h-96 font-mono text-xs"
              spellCheck={false}
            />
          </div>
          <div className="grid gap-2">
            <Label>Fields to publish</Label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {BUSINESS_INFORMATION_UPDATE_MASKS.map((field) => (
                <label key={field} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={updateMask.includes(field)}
                    onCheckedChange={(checked) =>
                      setUpdateMask((current) =>
                        checked === true
                          ? [...new Set([...current, field])]
                          : current.filter((item) => item !== field)
                      )
                    }
                  />
                  {field}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={confirmed}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
            />
            I reviewed the payload and approve overwriting the selected live
            Google fields.
          </label>
          <Button
            className="w-fit"
            disabled={!canWrite || !updateMask.length || busy}
            onClick={() => void publishLocation()}
          >
            <Send /> Validate and publish
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Categories and chains</CardTitle>
          <CardDescription>
            Search Google&apos;s live category IDs, service types, and chain
            resource names before adding them to the payload.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={searchType}
              onChange={(event) =>
                setSearchType(event.target.value as "categories" | "chains")
              }
            >
              <option value="categories">Categories</option>
              <option value="chains">Chains</option>
            </select>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Google metadata"
            />
            <Button variant="outline" disabled={busy} onClick={() => void runSearch()}>
              <Search /> Search
            </Button>
          </div>
          {searchResult ? (
            <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(searchResult, null, 2)}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Attributes</CardTitle>
          <CardDescription>
            Google determines available attributes from this location&apos;s
            category and region. Include an attribute in the mask without a
            matching value to delete it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {attributeGroups.map(([group, items]) => (
              <Badge key={group} variant="outline">
                {group}: {items.length}
              </Badge>
            ))}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="attributes-json">Attribute values</Label>
            <Textarea
              id="attributes-json"
              value={attributesJson}
              onChange={(event) => setAttributesJson(event.target.value)}
              className="min-h-72 font-mono text-xs"
              spellCheck={false}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="attribute-mask">Attribute mask</Label>
            <Input
              id="attribute-mask"
              value={attributeMask}
              onChange={(event) => setAttributeMask(event.target.value)}
              placeholder="attributes/wheelchair_accessible_entrance, …"
            />
          </div>
          <Button
            className="w-fit"
            disabled={!canWrite || !attributeMask.trim() || busy}
            onClick={() => void publishAttributes()}
          >
            <Send /> Publish attributes
          </Button>
        </CardContent>
      </Card>
    </section>
  )
}
