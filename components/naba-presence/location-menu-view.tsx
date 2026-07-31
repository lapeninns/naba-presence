"use client"

import { AlertTriangle, CheckCircle2, Pencil, Plus, RefreshCw, Send, Trash2, UtensilsCrossed } from "lucide-react"
import { useCallback, useEffect, useState, useTransition } from "react"

import { LiveDataError } from "@/components/naba-presence/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  type FoodMenu,
  type FoodMenuItem,
  type FoodMenusViewState,
  loadLocationFoodMenus,
  publishLocationFoodMenus,
  saveLocationFoodMenus,
} from "@/lib/naba-presence-api"

function cloneMenus(menus: FoodMenu[]) {
  return JSON.parse(JSON.stringify(menus)) as FoodMenu[]
}

function labelOf(value: { labels?: Array<{ displayName?: string }> }) {
  return value.labels?.find((label) => label.displayName)?.displayName ?? "Untitled"
}

function descriptionOf(value: { labels?: Array<{ description?: string }> }) {
  return value.labels?.find((label) => label.description)?.description ?? ""
}

function priceOf(item: FoodMenuItem) {
  const price = item.attributes.price
  if (!price) return null
  const amount = Number(price.units ?? 0) + Number(price.nanos ?? 0) / 1_000_000_000
  if (!Number.isFinite(amount)) return null
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: price.currencyCode }).format(amount) } catch { return `${price.currencyCode} ${amount.toFixed(2)}` }
}

function label(displayName: string, description?: string) {
  return [{ displayName, ...(description ? { description } : {}), languageCode: "en-GB" }]
}

function MenuPreview({ title, description, menus }: { title: string; description: string; menus: FoodMenu[] }) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="flex flex-col gap-5">{menus.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><UtensilsCrossed /></EmptyMedia><EmptyTitle>No menu content</EmptyTitle><EmptyDescription>This source currently has no Food Menus data.</EmptyDescription></EmptyHeader></Empty> : menus.map((menu, menuIndex) => <section key={`${labelOf(menu)}-${menuIndex}`} className="flex flex-col gap-3"><div><h3 className="font-semibold">{labelOf(menu)}</h3>{menu.cuisines?.length ? <p className="text-sm text-muted-foreground">{menu.cuisines.join(" · ")}</p> : null}</div>{menu.sections.map((section, sectionIndex) => <details key={`${labelOf(section)}-${sectionIndex}`} className="rounded-2xl border"><summary className="cursor-pointer px-4 py-3 font-medium">{labelOf(section)} <span className="font-normal text-muted-foreground">· {section.items.length} items</span></summary><div className="divide-y">{section.items.map((item, itemIndex) => <div key={`${labelOf(item)}-${itemIndex}`} className="flex items-start justify-between gap-4 px-4 py-3"><div className="min-w-0"><p className="font-medium">{labelOf(item)}</p>{descriptionOf(item) ? <p className="text-sm text-muted-foreground">{descriptionOf(item)}</p> : null}{item.options?.length ? <p className="mt-1 text-xs text-muted-foreground">{item.options.length} options</p> : null}</div>{priceOf(item) ? <span className="shrink-0 text-sm font-medium">{priceOf(item)}</span> : null}</div>)}</div></details>)}</section>)}</CardContent></Card>
}

function MenuEditor({ state, open, onOpenChange, onSaved }: {
  state: FoodMenusViewState
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [menus, setMenus] = useState(() => cloneMenus(state.canonicalMenus))
  const [pending, startTransition] = useTransition()
  const mutate = (updater: (next: FoodMenu[]) => void) => setMenus((current) => { const next = cloneMenus(current); updater(next); return next })

  function save() {
    startTransition(async () => {
      try {
        await saveLocationFoodMenus(state.location.id, { expectedCanonicalRevision: state.canonicalResource.revision, menus })
        toast.add({ type: "success", title: "Canonical menu saved" })
        onOpenChange(false)
        onSaved()
      } catch (error) {
        toast.add({ type: "error", title: error instanceof Error ? error.message : "Menu could not be saved." })
      }
    })
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>Edit NabaPresence Food Menus</DialogTitle><DialogDescription>Add, edit, and remove menus, sections, and items. Saving does not publish until you approve the Google replacement.</DialogDescription></DialogHeader><div className="flex flex-col gap-5">{menus.map((menu, menuIndex) => <section key={menuIndex} className="rounded-2xl border p-4"><div className="flex items-end gap-2"><div className="grid flex-1 gap-1"><Label>Menu name</Label><Input value={labelOf(menu)} onChange={(event) => mutate((next) => { next[menuIndex].labels = label(event.target.value) })} /></div><div className="grid flex-1 gap-1"><Label>Cuisines</Label><Input value={menu.cuisines?.join(", ") ?? ""} placeholder="British, Pub food" onChange={(event) => mutate((next) => { next[menuIndex].cuisines = event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></div><Button size="icon-sm" variant="ghost" aria-label="Remove menu" onClick={() => mutate((next) => { next.splice(menuIndex, 1) })}><Trash2 /></Button></div><div className="mt-4 flex flex-col gap-3">{menu.sections.map((section, sectionIndex) => <div key={sectionIndex} className="rounded-xl bg-muted/35 p-3"><div className="flex items-end gap-2"><div className="grid flex-1 gap-1"><Label>Section</Label><Input value={labelOf(section)} onChange={(event) => mutate((next) => { next[menuIndex].sections[sectionIndex].labels = label(event.target.value) })} /></div><Button size="icon-sm" variant="ghost" aria-label="Remove section" onClick={() => mutate((next) => { next[menuIndex].sections.splice(sectionIndex, 1) })}><Trash2 /></Button></div><div className="mt-3 flex flex-col gap-3">{section.items.map((item, itemIndex) => { const price = item.attributes.price; const amount = price ? Number(price.units ?? 0) + Number(price.nanos ?? 0) / 1_000_000_000 : 0; return <div key={itemIndex} className="grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-[1fr_1.5fr_8rem_auto]"><div className="grid gap-1"><Label>Item</Label><Input value={labelOf(item)} onChange={(event) => mutate((next) => { const current = next[menuIndex].sections[sectionIndex].items[itemIndex]; current.labels = label(event.target.value, descriptionOf(current)) })} /></div><div className="grid gap-1"><Label>Description</Label><Textarea className="min-h-8" value={descriptionOf(item)} onChange={(event) => mutate((next) => { const current = next[menuIndex].sections[sectionIndex].items[itemIndex]; current.labels = label(labelOf(current), event.target.value) })} /></div><div className="grid gap-1"><Label>Price (GBP)</Label><Input type="number" min="0" step="0.01" value={Number.isFinite(amount) ? amount.toFixed(2) : "0.00"} onChange={(event) => mutate((next) => { const numeric = Number(event.target.value); const units = Math.trunc(numeric); const nanos = Math.round((numeric - units) * 1_000_000_000); next[menuIndex].sections[sectionIndex].items[itemIndex].attributes.price = { currencyCode: "GBP", units: String(units), nanos } })} /></div><Button size="icon-sm" variant="ghost" className="mt-6" aria-label="Remove item" onClick={() => mutate((next) => { next[menuIndex].sections[sectionIndex].items.splice(itemIndex, 1) })}><Trash2 /></Button></div> })}<Button size="sm" variant="outline" className="self-start" onClick={() => mutate((next) => { next[menuIndex].sections[sectionIndex].items.push({ labels: label("New item"), attributes: { price: { currencyCode: "GBP", units: "0", nanos: 0 } } }) })}><Plus /> Add item</Button></div></div>)}<Button size="sm" variant="outline" className="self-start" onClick={() => mutate((next) => { next[menuIndex].sections.push({ labels: label("New section"), items: [] }) })}><Plus /> Add section</Button></div></section>)}<Button variant="outline" className="self-start" onClick={() => mutate((next) => next.push({ labels: label("New menu"), sections: [] }))}><Plus /> Add menu</Button></div><DialogFooter showCloseButton><Button onClick={save} disabled={pending}>{pending ? <Spinner /> : null} Save canonical menu</Button></DialogFooter></DialogContent></Dialog>
}

function ManagedMenus({ state, onRefresh }: { state: FoodMenusViewState; onRefresh: () => void }) {
  const [editOpen, setEditOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [pending, startTransition] = useTransition()
  function publish() { startTransition(async () => { try { await publishLocationFoodMenus(state.location.id, { expectedCanonicalRevision: state.canonicalResource.revision, expectedCanonicalHash: state.canonicalHash, expectedGoogleHash: state.googleHash }); toast.add({ type: "success", title: "Food Menus published and reconciled" }); setPublishOpen(false); setConfirmed(false); onRefresh() } catch (error) { toast.add({ type: "error", title: error instanceof Error ? error.message : "Food Menus could not be published." }) } }) }
  return <div className="flex flex-col gap-4">{!state.eligible ? <Alert variant="destructive"><AlertTriangle /><AlertTitle>Google does not allow Food Menus here</AlertTitle><AlertDescription>The location metadata reports that Food Menus are unsupported for this profile.</AlertDescription></Alert> : null}{!state.writesEnabled ? <Alert><AlertTriangle /><AlertTitle>Google publishing is paused</AlertTitle><AlertDescription>NabaPresence menu editing remains available.</AlertDescription></Alert> : null}<Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2">Food Menus <Badge variant={state.status === "in_sync" ? "secondary" : "outline"}>{state.status === "in_sync" ? "In sync" : "Changes ready"}</Badge></CardTitle><CardDescription>NabaPresence is canonical. Google&apos;s complete Food Menus resource is read live and replaced only after approval.</CardDescription></div><div className="flex gap-2"><Button variant="outline" onClick={onRefresh}><RefreshCw /> Refresh</Button><Button variant="outline" onClick={() => setEditOpen(true)} disabled={!state.canPublish}><Pencil /> Edit menu</Button><Button onClick={() => setPublishOpen(true)} disabled={state.status === "in_sync" || !state.eligible || !state.canPublish || !state.writesEnabled}><Send /> Review publish</Button></div></div></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["NabaPresence items", state.canonicalCounts.items], ["Google items", state.googleCounts.items], ["Menus", state.canonicalCounts.menus], ["Sections", state.canonicalCounts.sections]].map(([name, value]) => <div key={String(name)} className="rounded-2xl border p-4"><p className="text-sm text-muted-foreground">{name}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}</CardContent></Card><div className="grid items-start gap-4 xl:grid-cols-2"><MenuPreview title="NabaPresence canonical menu" description={`Revision ${state.canonicalResource.revision} · updated ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.canonicalResource.updatedAt))}`} menus={state.canonicalMenus} /><MenuPreview title="Google published menu" description="Current live Google Business Profile resource." menus={state.googleMenus} /></div>{editOpen ? <MenuEditor state={state} open onOpenChange={setEditOpen} onSaved={onRefresh} /> : null}<Dialog open={publishOpen} onOpenChange={(open) => { setPublishOpen(open); if (!open) setConfirmed(false) }}><DialogContent><DialogHeader><DialogTitle>Replace Google Food Menus?</DialogTitle><DialogDescription>This publishes the reviewed NabaPresence menu as one complete replacement. Google-only menu content will be removed.</DialogDescription></DialogHeader><label className="flex items-start gap-3 rounded-2xl border p-4"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} /> I reviewed both versions and approve the full replacement.</label><DialogFooter showCloseButton><Button onClick={publish} disabled={!confirmed || pending}>{pending ? <Spinner /> : <CheckCircle2 />} Publish and verify</Button></DialogFooter></DialogContent></Dialog></div>
}

export function LocationMenuView({ locationId }: { locationId: string }) {
  const [state, setState] = useState<FoodMenusViewState | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => { setLoading(true); setError(false); try { setState((await loadLocationFoodMenus(locationId)).foodMenus) } catch { setError(true) } finally { setLoading(false) } }, [locationId])
  useEffect(() => { let active = true; void loadLocationFoodMenus(locationId).then((result) => { if (active) setState(result.foodMenus) }).catch(() => { if (active) setError(true) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [locationId])
  if (loading && !state) return <div className="flex flex-col gap-4"><Skeleton className="h-32" /><Skeleton className="h-96" /></div>
  if (error || !state) return <LiveDataError onRetry={() => void refresh()} />
  return <ManagedMenus state={state} onRefresh={() => void refresh()} />
}
