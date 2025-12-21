export function formatDateYYYYMMDD(date: Date, timeZone = "America/New_York"): string {
  // We use `formatToParts()` so we don't depend on locale-specific separators/order.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Failed to format date (tz=${timeZone})`);
  }

  return `${year}-${month}-${day}`;
}

export function getTodayNYDateString(now = new Date()): string {
  return formatDateYYYYMMDD(now, "America/New_York");
}

export function assertYYYYMMDD(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Expected YYYY-MM-DD, got: ${date}`);
  }
}
