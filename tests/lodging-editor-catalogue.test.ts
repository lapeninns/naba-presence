import { describe, expect, it } from "vitest"
import { GOOGLE_LODGING_UPDATE_PATHS } from "@/lib/domain/google-lodging"
import { LODGING_EDITOR_EXCLUSIONS, LODGING_EDITOR_GROUPS, lodgingCataloguePath, lodgingEditorCoverage, lodgingFieldLabel } from "@/lib/locations/forms/lodging-catalogue"

describe("full pinned lodging editor catalogue", () => {
  const coverage = lodgingEditorCoverage()
  it("accounts for every writable field-mask path with a typed control or explicit system reason", () => {
    // A single time control writes every google.type.TimeOfDay component.
    const timeComponent = (path: string) => coverage.get(path.split(".").slice(0, -1).join("."))?.kind === "time"
    const missing = [...GOOGLE_LODGING_UPDATE_PATHS].filter((path) => !coverage.has(path) && !LODGING_EDITOR_EXCLUSIONS[path] && !timeComponent(path))
    expect(missing).toEqual([])
    expect(LODGING_EDITOR_GROUPS).toHaveLength(19)
  })
  it("excludes provider aggregates and resource identity from editable controls", () => {
    for (const path of ["name", "allUnits", "someUnits", "metadata.updateTime"]) {
      expect(coverage.has(path)).toBe(false)
      expect(LODGING_EDITOR_EXCLUSIONS[path]).toBeTruthy()
    }
  })
  it("includes nested guest-unit, language and certification fields even though their masks replace a collection", () => {
    expect(coverage.get("guestUnits[].features.totalLivingAreas.sleeping.bedsCount")).toMatchObject({ kind: "integer", updatePath: "guestUnits" })
    expect(coverage.get("services.languagesSpoken[].spoken")).toMatchObject({ kind: "boolean", updatePath: "services.languagesSpoken" })
    expect(coverage.get("sustainability.sustainabilityCertifications.ecoCertifications[].awardedException")).toMatchObject({ kind: "enum", updatePath: "sustainability.sustainabilityCertifications.ecoCertifications" })
    expect(coverage.get("guestUnits[].codes[]")).toMatchObject({ kind: "text", updatePath: "guestUnits" })
  })
  it("has typed unknown-capable booleans, exception enums and one time control per TimeOfDay", () => {
    expect(coverage.get("parking.freeParking")).toMatchObject({ kind: "boolean" })
    expect(coverage.get("parking.freeParkingException")).toMatchObject({ kind: "enum", values: expect.arrayContaining(["DEPENDENT_ON_SEASON"]) })
    for (const path of ["policies.checkinTime", "policies.checkoutTime"]) {
      expect(coverage.get(path)).toMatchObject({ kind: "time", updatePath: path })
      expect(GOOGLE_LODGING_UPDATE_PATHS.has(path)).toBe(true)
      for (const component of ["hours", "minutes", "seconds", "nanos"]) expect(coverage.has(`${path}.${component}`)).toBe(false)
    }
    expect(coverage.get("policies.checkinTime")?.label).toBe("Check-in time")
  })
  it("humanises schema keys with readable acronyms", () => {
    expect(lodgingFieldLabel("adaCompliantUnit")).toBe("ADA compliant unit")
    expect(lodgingFieldLabel("inunitSafe")).toBe("In-unit safe")
    expect(lodgingFieldLabel("inunitWifiAvailable")).toBe("In-unit Wi-Fi available")
    expect(lodgingFieldLabel("tv")).toBe("TV")
    expect(lodgingFieldLabel("tvStreaming")).toBe("TV streaming")
    expect(lodgingFieldLabel("mobileNfc")).toBe("Mobile NFC")
    expect(lodgingFieldLabel("freeWifi")).toBe("Free Wi-Fi")
    expect(lodgingFieldLabel("twentyFourHourFrontDesk")).toBe("24-hour front desk")
    expect(lodgingFieldLabel("BREEAM_VERY_GOOD")).toBe("BREEAM very good")
    expect(lodgingFieldLabel("guestUnits")).toBe("Guest units")
  })
  it("maps draft paths to catalogue paths", () => {
    expect(lodgingCataloguePath("guestUnits.0.codes.2")).toBe("guestUnits[].codes[]")
    expect(lodgingCataloguePath(["services", "languagesSpoken", 1, "languageCode"])).toBe("services.languagesSpoken[].languageCode")
  })
})
