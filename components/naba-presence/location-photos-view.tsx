"use client"

import Image from "next/image"
import { Camera, ExternalLink, Link2, Trash2, Upload } from "lucide-react"
import { useEffect, useState } from "react"

import { LiveDataError } from "@/components/naba-presence/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createLocationMedia,
  deleteLocationMedia,
  loadLocationMedia,
  uploadLocationMedia,
  updateLocationMedia,
  type MediaCategory,
  type MediaState,
} from "@/lib/naba-presence-api"

const labels = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())

export function LocationPhotosView({ locationId }: { locationId: string }) {
  const [data, setData] = useState<MediaState | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [reloadKey, setReloadKey] = useState(0)
  const [sourceUrl, setSourceUrl] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState<MediaCategory>("ADDITIONAL")
  const [format, setFormat] = useState<"PHOTO" | "VIDEO">("PHOTO")
  const [description, setDescription] = useState("")
  const [pending, setPending] = useState<null | { kind: "create"; source: "file" | "url" } | { kind: "delete"; item: MediaState["items"][number] }>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void loadLocationMedia(locationId).then(({ media }) => {
      if (active) { setData(media); setStatus("ready") }
    }).catch(() => { if (active) setStatus("error") })
    return () => { active = false }
  }, [locationId, reloadKey])

  async function confirm() {
    if (!pending) return
    setBusy(true); setMessage(null)
    try {
      if (pending.kind === "create") {
        if (pending.source === "file") {
          if (!file) throw new Error("Choose a file first.")
          await uploadLocationMedia(locationId, { mediaFormat: format, category, file, description: description || undefined })
        } else {
          await createLocationMedia(locationId, { mediaFormat: format, category, sourceUrl, description: description || undefined })
        }
        setSourceUrl(""); setFile(null); setDescription(""); setMessage("Media created and verified on Google.")
      } else {
        await deleteLocationMedia(locationId, pending.item.id, pending.item.googleHash)
        setMessage("Media deleted from Google.")
      }
      setPending(null); setReloadKey((value) => value + 1)
    } catch (error) { setMessage(error instanceof Error ? error.message : "The media change failed.") }
    finally { setBusy(false) }
  }

  async function changeCategory(item: MediaState["items"][number], next: MediaCategory) {
    setBusy(true); setMessage(null)
    try {
      await updateLocationMedia(locationId, item.id, next, item.googleHash)
      setMessage("Media category updated and verified on Google."); setReloadKey((value) => value + 1)
    } catch (error) { setMessage(error instanceof Error ? error.message : "The category change failed.") }
    finally { setBusy(false) }
  }

  if (status === "error") return <LiveDataError onRetry={() => setReloadKey((value) => value + 1)} />
  if (!data) return <Skeleton className="h-96 w-full" />
  const canWrite = data.canPublish && data.writesEnabled
  let validUrl = false
  try { validUrl = ["http:", "https:"].includes(new URL(sourceUrl).protocol) } catch { validUrl = false }

  return <section className="flex flex-col gap-(--nr-gap-section)" aria-label="Google media">
    {!data.writesEnabled ? <Alert><Camera /><AlertTitle>Media writes are paused</AlertTitle><AlertDescription>Owner and customer media remain visible. Uploads, category changes, and deletions stay fail closed until GBP_MEDIA_ENABLED and publishing are enabled.</AlertDescription></Alert> : null}
    {message ? <Alert><Camera /><AlertTitle>Media status</AlertTitle><AlertDescription>{message}</AlertDescription></Alert> : null}
    <Card><CardHeader><CardTitle>Add media</CardTitle><CardDescription>Upload a local file directly, or let Google fetch one from a public URL. Photos normally need at least 250 px on the short edge and 10 KB.</CardDescription></CardHeader><CardContent>
      <FieldGroup>
        <Field><FieldLabel htmlFor="media-file">Direct file upload</FieldLabel><Input id="media-file" type="file" accept={format === "PHOTO" ? "image/jpeg,image/png" : "video/mp4,video/quicktime"} disabled={!canWrite} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><FieldDescription>JPEG, PNG, MP4, or QuickTime; up to 75 MB. The file is streamed to Google and is not retained by NabaPresence.</FieldDescription></Field>
        <Field><FieldLabel htmlFor="media-source-url">Or public source URL</FieldLabel><Input id="media-source-url" type="url" value={sourceUrl} disabled={!canWrite} onChange={(event) => setSourceUrl(event.target.value)} /><FieldDescription>The URL must be publicly accessible to Google.</FieldDescription></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field><FieldLabel htmlFor="media-format">Format</FieldLabel><NativeSelect id="media-format" value={format} disabled={!canWrite} onValueChange={(value) => setFormat(value as "PHOTO" | "VIDEO")}><NativeSelectOption value="PHOTO">Photo</NativeSelectOption><NativeSelectOption value="VIDEO">Video</NativeSelectOption></NativeSelect></Field>
          <Field><FieldLabel htmlFor="media-category">Category</FieldLabel><NativeSelect id="media-category" value={category} disabled={!canWrite} onValueChange={(value) => setCategory(value as MediaCategory)}>{data.categories.map((item) => <NativeSelectOption key={item} value={item}>{labels(item)}</NativeSelectOption>)}</NativeSelect></Field>
        </div>
        <Field><FieldLabel htmlFor="media-description">Description</FieldLabel><Input id="media-description" value={description} disabled={!canWrite || category === "COVER"} maxLength={1500} onChange={(event) => setDescription(event.target.value)} /><FieldDescription>Descriptions are set only on creation and are not supported for cover photos.</FieldDescription></Field>
        <div className="flex flex-wrap gap-2"><Button disabled={!canWrite || !file} onClick={() => setPending({ kind: "create", source: "file" })}><Upload />Review file upload</Button><Button variant="outline" disabled={!canWrite || !validUrl} onClick={() => setPending({ kind: "create", source: "url" })}><Link2 />Review URL import</Button></div>
      </FieldGroup>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Live Google gallery</CardTitle><CardDescription>Customer contributions include Google&apos;s required attribution and remain read-only.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {data.items.map((item) => {
        const preview = item.thumbnailUrl ?? item.googleUrl
        return <article key={item.id} className="overflow-hidden rounded-lg border">
          <div className="relative aspect-video bg-muted">{preview ? <Image src={preview} alt={item.description || `${labels(item.category ?? item.mediaFormat)} media`} fill unoptimized className="object-cover" /> : <div className="grid h-full place-items-center"><Camera className="size-8 text-muted-foreground" /></div>}</div>
          <div className="space-y-3 p-4"><div className="flex flex-wrap gap-2"><Badge>{labels(item.category ?? item.mediaFormat)}</Badge><Badge variant="outline">{item.ownership === "merchant" ? "Owner" : "Customer"}</Badge></div>
            {item.description ? <p className="text-sm">{item.description}</p> : null}
            {item.attribution?.profileName ? <p className="text-sm text-muted-foreground">By {item.attribution.profileName}{item.attribution.profileUrl ? <> · <a className="underline" href={item.attribution.profileUrl} target="_blank" rel="noreferrer">Google profile <ExternalLink className="inline size-3" /></a></> : null}</p> : null}
            {item.ownership === "merchant" ? <div className="flex gap-2"><NativeSelect value={item.category ?? "ADDITIONAL"} disabled={!canWrite || busy} aria-label="Media category" onValueChange={(value) => void changeCategory(item, value as MediaCategory)}>{data.categories.filter((value) => !["COVER", "PROFILE"].includes(value)).map((value) => <NativeSelectOption key={value} value={value}>{labels(value)}</NativeSelectOption>)}</NativeSelect><Button size="icon-sm" variant="destructive" disabled={!canWrite || busy} aria-label="Delete media" onClick={() => setPending({ kind: "delete", item })}><Trash2 /></Button></div> : item.attribution?.takedownUrl ? <a className="text-sm text-primary underline" href={item.attribution.takedownUrl} target="_blank" rel="noreferrer">Report this media</a> : null}
          </div>
        </article>
      })}
      {!data.items.length ? <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Google returned no media for this location.</p> : null}
    </CardContent></Card>
    <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}><DialogContent><DialogHeader><DialogTitle>{pending?.kind === "delete" ? "Delete this owner media?" : "Publish this media to Google?"}</DialogTitle><DialogDescription>{pending?.kind === "delete" ? "The item will be removed from the Google gallery after a stale-state check." : pending?.source === "file" ? `${file?.name ?? "The selected file"} will be uploaded directly to Google as ${labels(category).toLowerCase()}.` : `Google will fetch ${sourceUrl} and add it as ${labels(category).toLowerCase()}.`}</DialogDescription></DialogHeader><DialogFooter showCloseButton><Button variant={pending?.kind === "delete" ? "destructive" : "default"} disabled={busy} onClick={() => void confirm()}>{busy ? "Working…" : "Confirm"}</Button></DialogFooter></DialogContent></Dialog>
  </section>
}
