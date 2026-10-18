import { vi } from "vitest"

/** Simulate WebKit's en-GB September and year/date-time connector at the native boundary. */
export function mockWebkitShortSeptember() {
  const prototype = Intl.DateTimeFormat.prototype
  const nativeFormat = Object.getOwnPropertyDescriptor(
    prototype,
    "format"
  )!.get!
  const nativeParts = prototype.formatToParts
  const nativeDateString = Date.prototype.toLocaleDateString
  const nativeDateTimeString = Date.prototype.toLocaleString
  const september = (value: string) => value.replace(/\bSept\b/g, "Sep")

  vi.spyOn(prototype, "format", "get").mockImplementation(function (
    this: Intl.DateTimeFormat
  ) {
    const format = nativeFormat.call(this) as (date?: Date | number) => string
    const withYearAndTime =
      this.resolvedOptions().year && this.resolvedOptions().hour
    return (date?: Date | number) => {
      const value = september(format(date))
      return withYearAndTime
        ? value.replace(/, (?=\d{2}:\d{2})/, " at ")
        : value
    }
  })
  vi.spyOn(prototype, "formatToParts").mockImplementation(function (
    this: Intl.DateTimeFormat,
    date?: Date | number
  ) {
    const withYear = this.resolvedOptions().year
    return nativeParts.call(this, date).map((part, index, parts) => {
      if (part.type === "month")
        return { ...part, value: september(part.value) }
      if (
        withYear &&
        part.type === "literal" &&
        part.value === ", " &&
        parts[index + 1]?.type === "hour"
      ) {
        return { ...part, value: " at " }
      }
      return part
    })
  })
  vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (
    this: Date,
    ...args: Parameters<Date["toLocaleDateString"]>
  ) {
    return september(nativeDateString.apply(this, args))
  })
  vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (
    this: Date,
    ...args: Parameters<Date["toLocaleString"]>
  ) {
    return september(nativeDateTimeString.apply(this, args))
  })
}
