"use client"

import { DownloadIcon, QrCodeIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"
import { encodeQr, reviewLinkQrSvg } from "@/lib/domain/review-link-qr"

/**
 * The review link's QR code: a preview and its PNG and SVG downloads, all
 * drawn in the browser from the same SVG (lib/domain/review-link-qr.ts), so
 * what is previewed is what prints. Black on white whatever the theme: a
 * printed code needs the contrast.
 *
 * Until a QR encoder is approved `encodeQr` returns null; the preview then
 * says so and the downloads are off with the reason. Everything else on the
 * page works without it.
 */

/** Pixels per module in the PNG: a 41-module code is 656 px, crisp at A6. */
const PNG_SCALE = 16

export const QR_NOT_READY = "The QR code isn’t ready yet."

/** The code as an SVG document, or null while no encoder is available. */
export function useReviewLinkQrSvg(
  value: string | null,
  options: { caption: string | null; label: string }
): string | null {
  const { caption, label } = options
  return React.useMemo(() => {
    if (!value) return null
    const matrix = encodeQr(value)
    return matrix ? reviewLinkQrSvg(matrix, { caption, label }) : null
  }, [value, caption, label])
}

/** The QR preview, or a placeholder that says why there is none. */
export function QrImage({
  svg,
  label,
  unavailable,
}: {
  svg: string | null
  label: string
  /** Why there is no code to show (the link is off), when it isn't the encoder. */
  unavailable?: { title: string; body: string } | null
}) {
  if (!svg) {
    const title = unavailable?.title ?? QR_NOT_READY
    const body =
      unavailable?.body ??
      "The link works now. The code and its downloads will appear here soon."
    return (
      <div
        data-slot="review-link-qr-placeholder"
        className="flex aspect-square w-full max-w-56 flex-col items-center justify-center gap-2 rounded-(--np-radius-card) border border-dashed border-line-strong bg-surface-alt p-4 text-center"
      >
        <QrCodeIcon
          aria-hidden
          strokeWidth={1.75}
          className="size-8 text-ink-faint"
        />
        <p className="text-ui text-ink-secondary">{title}</p>
        <p className="text-caption text-ink-muted">{body}</p>
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a QR code drawn in the browser, as a data URI
    <img
      data-slot="review-link-qr"
      src={svgDataUri(svg)}
      alt={label}
      className="aspect-square h-auto w-full max-w-56 rounded-(--np-radius-card) border border-line"
    />
  )
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Saves a blob under `filename`; the URL outlives the click for iOS Safari. */
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.rel = "noopener"
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** The SVG drawn onto a canvas at print resolution. */
async function svgToPng(svg: string): Promise<Blob> {
  const image = new Image()
  image.decoding = "async"
  image.src = svgDataUri(svg)
  await image.decode()
  const canvas = document.createElement("canvas")
  const ratio = image.naturalHeight / image.naturalWidth || 1
  const width = Math.round((image.naturalWidth / 8) * PNG_SCALE)
  canvas.width = width
  canvas.height = Math.round(width * ratio)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("No canvas")
  context.imageSmoothingEnabled = false
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No PNG"))),
      "image/png"
    )
  )
}

/** PNG and SVG downloads of the code, named after the venue. */
export function QrDownloads({
  svg,
  fileStem,
  disabledReason,
}: {
  svg: string | null
  /** "the-old-crown-review-qr": the file name without its extension. */
  fileStem: string
  /** Why the downloads are off, when the link is. */
  disabledReason: string | null
}) {
  const toast = useToastManager()
  const [saving, setSaving] = React.useState(false)
  const reason = disabledReason ?? (svg ? null : QR_NOT_READY)

  async function savePng() {
    if (!svg) return
    setSaving(true)
    try {
      download(await svgToPng(svg), `${fileStem}.png`)
    } catch {
      toast.add({
        title: "Couldn’t make the PNG. Try the SVG instead.",
        type: "error",
      })
    } finally {
      setSaving(false)
    }
  }

  function saveSvg() {
    if (!svg) return
    download(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
      `${fileStem}.svg`
    )
  }

  return (
    <div className="flex flex-wrap gap-2" data-slot="review-link-qr-downloads">
      <Button
        variant="secondary"
        onClick={() => void savePng()}
        pending={saving}
        pendingLabel="Preparing…"
        disabledReason={reason ?? undefined}
      >
        <DownloadIcon aria-hidden />
        Download PNG
      </Button>
      <Button
        variant="secondary"
        onClick={saveSvg}
        disabledReason={reason ?? undefined}
      >
        <DownloadIcon aria-hidden />
        Download SVG
      </Button>
    </div>
  )
}
