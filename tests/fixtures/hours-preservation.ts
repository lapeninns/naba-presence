import type { GoogleLocationHours } from "@/lib/domain/hours-vocabulary"

const period = (
  openDay: string,
  closeDay: string,
  opens: number,
  closes: number
) => ({
  openDay,
  closeDay,
  openTime: { hours: opens, minutes: 0 },
  closeTime: { hours: closes, minutes: 0 },
})
export const mixedHoursFixture: GoogleLocationHours = {
  regularHours: {
    periods: [
      period("MONDAY", "MONDAY", 11, 15),
      period("MONDAY", "TUESDAY", 18, 2),
      period("SATURDAY", "SUNDAY", 20, 1),
      period("SUNDAY", "MONDAY", 22, 2),
      period("WEDNESDAY", "WEDNESDAY", 0, 24),
      period("THURSDAY", "THURSDAY", 10, 10),
    ],
  },
  specialHours: {
    specialHourPeriods: [
      {
        startDate: { year: 2026, month: 12, day: 31 },
        endDate: { year: 2027, month: 1, day: 1 },
        openTime: { hours: 18 },
        closeTime: { hours: 2 },
      },
    ],
  },
  moreHours: [
    { hoursTypeId: "KITCHEN", periods: [period("MONDAY", "MONDAY", 12, 15)] },
    { hoursTypeId: "BAR", periods: [period("SUNDAY", "MONDAY", 18, 2)] },
  ],
}
