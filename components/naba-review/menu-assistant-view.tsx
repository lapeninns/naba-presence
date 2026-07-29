"use client"

import {
  Bot,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileUp,
  Info,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  UtensilsCrossed,
} from "lucide-react"
import { useEffect, useState, useTransition } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import {
  importMenu,
  loadInternalLocations,
  loadMenus,
  type InternalLocation,
  type ManagedMenu,
  setMenuPublished,
} from "@/lib/naba-review-api"

function itemCount(menu: ManagedMenu) {
  return menu.content.categories.reduce(
    (total, category) => total + category.items.length,
    0
  )
}

function formatBytes(value: number) {
  return `${(value / 1024 / 1024).toFixed(value > 1024 * 1024 ? 1 : 2)} MB`
}

export function MenuAssistantView({
  onNavigate,
}: {
  onNavigate: () => void
}) {
  const [locations, setLocations] = useState<InternalLocation[]>([])
  const [menus, setMenus] = useState<ManagedMenu[]>([])
  const [selectedLocationId, setSelectedLocationId] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading")
  const [isPending, startTransition] = useTransition()
  const selectedMenu = menus.find(
    (menu) => menu.locationId === selectedLocationId
  )

  async function refresh() {
    const [locationResult, menuResult] = await Promise.all([
      loadInternalLocations(),
      loadMenus(),
    ])
    setLocations(locationResult.locations)
    setMenus(menuResult.menus)
    setSelectedLocationId((current) => {
      if (locationResult.locations.some((item) => item.locationId === current)) {
        return current
      }
      return locationResult.locations[0]?.locationId ?? ""
    })
  }

  useEffect(() => {
    let active = true
    void Promise.all([loadInternalLocations(), loadMenus()])
      .then(([locationResult, menuResult]) => {
        if (!active) return
        setLocations(locationResult.locations)
        setMenus(menuResult.menus)
        setSelectedLocationId(locationResult.locations[0]?.locationId ?? "")
        setLoadState("ready")
      })
      .catch(() => {
        if (active) setLoadState("unavailable")
      })
    return () => {
      active = false
    }
  }, [])

  function upload() {
    if (!selectedLocationId || !file) return
    startTransition(async () => {
      try {
        await importMenu(selectedLocationId, file)
        await refresh()
        setFile(null)
        toast.add({
          title: "Menu extracted",
          description: "Review the structured menu, then publish it for guests.",
          type: "success",
        })
      } catch (error) {
        toast.add({
          title: "Menu import failed",
          description:
            error instanceof Error
              ? error.message
              : "The menu could not be imported.",
          type: "error",
        })
      }
    })
  }

  function togglePublished() {
    if (!selectedMenu) return
    startTransition(async () => {
      try {
        await setMenuPublished(selectedMenu.id, !selectedMenu.isPublished)
        await refresh()
        toast.add({
          title: selectedMenu.isPublished ? "Menu unpublished" : "Menu is live",
          description: selectedMenu.isPublished
            ? "Guests can no longer open or chat with this menu."
            : "The guest link is ready to share or turn into a QR code.",
          type: "success",
        })
      } catch (error) {
        toast.add({
          title: "Publication failed",
          description:
            error instanceof Error
              ? error.message
              : "The publication state could not be changed.",
          type: "error",
        })
      }
    })
  }

  async function copyGuestLink() {
    if (!selectedMenu) return
    await navigator.clipboard.writeText(
      `${window.location.origin}/menu/${selectedMenu.publicSlug}`
    )
    toast.add({
      title: "Guest link copied",
      description: "You can use this URL in a QR code or on your website.",
      type: "success",
    })
  }

  if (loadState === "loading") {
    return (
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </main>
    )
  }

  if (loadState === "unavailable") {
    return (
      <main className="mx-auto w-full max-w-7xl p-4 md:p-6">
        <Alert variant="destructive">
          <RefreshCw />
          <AlertTitle>Menu workspace could not be loaded</AlertTitle>
          <AlertDescription>
            Check the database connection and try again.
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="mb-1 flex items-center gap-2 text-sm font-medium text-primary">
            <Bot className="size-4" aria-hidden />
            Guest experience
          </p>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Menu assistant
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Upload an approved menu and give guests a link where they can ask
            questions by text or voice.
          </p>
        </div>
        {selectedMenu?.isPublished ? (
          <Badge variant="secondary">
            <CheckCircle2 data-icon="inline-start" />
            Live for guests
          </Badge>
        ) : (
          <Badge variant="outline">Draft</Badge>
        )}
      </div>

      {!locations.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a location first</CardTitle>
            <CardDescription>
              Menus belong to an imported Google Business Profile location.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={onNavigate}>Go to Connections</Button>
          </CardFooter>
        </Card>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Menu source</CardTitle>
                <CardDescription>
                  PDF or clear menu images work best. The original file is
                  processed for extraction and is not stored.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="menu-location">Location</Label>
                  <NativeSelect
                    id="menu-location"
                    className="w-full"
                    value={selectedLocationId}
                    onValueChange={(value) => {
                      setSelectedLocationId(value)
                      setFile(null)
                    }}
                    disabled={isPending}
                  >
                    {locations.map((location) => (
                      <NativeSelectOption
                        key={location.locationId}
                        value={location.locationId}
                      >
                        {location.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="menu-file">Menu file</Label>
                  <Input
                    id="menu-file"
                    type="file"
                    className="h-auto py-2"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.md"
                    disabled={isPending}
                    onChange={(event) =>
                      setFile(event.currentTarget.files?.[0] ?? null)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    PDF, JPG, PNG, WebP, TXT or Markdown · 15 MB maximum
                  </p>
                </div>
                {file ? (
                  <div className="rounded-2xl bg-secondary p-3 text-sm">
                    <p className="truncate font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(file.size)}
                    </p>
                  </div>
                ) : null}
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  onClick={upload}
                  disabled={!file || !selectedLocationId || isPending}
                >
                  {isPending ? <Spinner /> : <Sparkles />}
                  {selectedMenu ? "Replace and re-extract" : "Extract menu"}
                </Button>
              </CardFooter>
            </Card>

            <Alert>
              <ShieldAlert />
              <AlertTitle>Allergen answers stay cautious</AlertTitle>
              <AlertDescription>
                The assistant never promises that food is allergy-safe and
                directs guests to staff when allergen information is incomplete.
              </AlertDescription>
            </Alert>
          </div>

          {selectedMenu ? (
            <Card>
              <CardHeader>
                <CardTitle>{selectedMenu.name}</CardTitle>
                <CardDescription>
                  {selectedMenu.locationName} · Version {selectedMenu.version} ·{" "}
                  {itemCount(selectedMenu)} items from{" "}
                  {selectedMenu.sourceFilename}
                </CardDescription>
                <CardAction>
                  <Badge
                    variant={
                      selectedMenu.isPublished ? "secondary" : "outline"
                    }
                  >
                    {selectedMenu.isPublished ? "Published" : "Needs review"}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {selectedMenu.content.notes.length ? (
                  <Alert>
                    <Info />
                    <AlertTitle>Menu notes</AlertTitle>
                    <AlertDescription>
                      {selectedMenu.content.notes.join(" · ")}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex flex-col gap-6">
                  {selectedMenu.content.categories.map((category) => (
                    <section key={category.name} className="flex flex-col gap-3">
                      <div>
                        <h2 className="font-heading text-base font-semibold">
                          {category.name}
                        </h2>
                        {category.description ? (
                          <p className="text-sm text-muted-foreground">
                            {category.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="divide-y rounded-2xl border">
                        {category.items.map((item, index) => (
                          <div
                            key={`${item.name}-${index}`}
                            className="flex gap-4 p-4"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium">{item.name}</p>
                              {item.description ? (
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {item.description}
                                </p>
                              ) : null}
                              {item.dietaryTags.length ||
                              item.allergens.length ? (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {item.dietaryTags.map((tag) => (
                                    <Badge key={tag} variant="secondary">
                                      {tag}
                                    </Badge>
                                  ))}
                                  {item.allergens.map((allergen) => (
                                    <Badge
                                      key={allergen}
                                      variant="destructive"
                                    >
                                      {allergen}
                                    </Badge>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            <span className="shrink-0 font-mono text-sm font-medium">
                              {item.price ?? "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </CardContent>
              <Separator />
              <CardFooter className="flex flex-wrap gap-2">
                <Button onClick={togglePublished} disabled={isPending}>
                  {isPending ? <Spinner /> : <UtensilsCrossed />}
                  {selectedMenu.isPublished ? "Unpublish" : "Publish menu"}
                </Button>
                {selectedMenu.isPublished ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() =>
                        window.open(
                          `/menu/${selectedMenu.publicSlug}`,
                          "_blank",
                          "noopener,noreferrer"
                        )
                      }
                    >
                      <ExternalLink />
                      Open guest menu
                    </Button>
                    <Button variant="ghost" onClick={copyGuestLink}>
                      <Copy />
                      Copy link
                    </Button>
                  </>
                ) : null}
              </CardFooter>
            </Card>
          ) : (
            <Card className="min-h-96 items-center justify-center text-center">
              <CardContent className="flex max-w-md flex-col items-center gap-3 py-12">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary">
                  <FileUp className="size-5" aria-hidden />
                </span>
                <div>
                  <h2 className="font-heading text-base font-semibold">
                    No menu for this location
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Upload the current customer menu. You will review the
                    extracted dishes and prices before anything is published.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </main>
  )
}
