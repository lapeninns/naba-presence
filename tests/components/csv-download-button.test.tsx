import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CsvDownloadButton,
  ReportExportScope,
} from "@/components/reporting/csv-download-button"

let downloaded: string[]

beforeEach(() => {
  downloaded = []
  // jsdom has no object URLs and does not navigate; read the file name the
  // browser would be handed.
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:test")
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    downloaded.push(this.download)
  })
})

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"))
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const rows = () => [["Week", "Reviews"]]

describe("CsvDownloadButton outside a report scope (the shared report)", () => {
  it("keeps its file name and says nothing more", () => {
    render(<CsvDownloadButton filename="review-volume.csv" rows={rows} />)
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }))
    expect(downloaded).toEqual(["review-volume.csv"])
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })
})

describe("CsvDownloadButton in a report scope", () => {
  function renderScoped(button: React.ReactNode) {
    return render(
      <ReportExportScope value={{ name: "Journey Hospitality" }}>
        <ReportExportScope value={{ period: "2026-09-30 2026-10-27" }}>
          {button}
        </ReportExportScope>
      </ReportExportScope>
    )
  }

  it("names the file for the client and the dates, and says the download started", () => {
    vi.useFakeTimers()
    renderScoped(<CsvDownloadButton filename="review-volume.csv" rows={rows} />)
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }))
    expect(downloaded).toEqual([
      "journey-hospitality-review-volume-2026-09-30-2026-10-27.csv",
    ])
    expect(screen.getByRole("status")).toHaveTextContent(
      "Downloading journey-hospitality-review-volume-2026-09-30-2026-10-27.csv"
    )
    act(() => {
      vi.advanceTimersByTime(4_000)
    })
    expect(screen.getByRole("status")).toBeEmptyDOMElement()
  })

  it("does not repeat dates the name already carries", () => {
    render(
      <ReportExportScope
        value={{ name: "Old Crown", period: "2026-08-04 2026-08-31" }}
      >
        <CsvDownloadButton
          filename="google-profile-totals-2026-08-04-2026-08-31.csv"
          rows={rows}
        />
      </ReportExportScope>
    )
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }))
    expect(downloaded).toEqual([
      "old-crown-google-profile-totals-2026-08-04-2026-08-31.csv",
    ])
  })

  it("says so when the file could not be made", () => {
    renderScoped(
      <CsvDownloadButton
        filename="review-volume.csv"
        rows={() => {
          throw new Error("no rows")
        }}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }))
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn’t make this file. Try again."
    )
    expect(downloaded).toEqual([])
  })
})
