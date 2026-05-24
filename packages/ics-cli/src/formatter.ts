import type { CalendarEvent } from "./types.ts";

export function formatJson(events: CalendarEvent[]): string {
  return JSON.stringify(events, null, 2);
}

export function formatTable(events: CalendarEvent[]): string {
  if (events.length === 0) return "No events found.";

  const hasCalendar = events.some((e) => e.calendar);
  const hasLocation = events.some((e) => e.location);

  // Calculate column widths
  const rows = events.map((e) => {
    const startDate = e.allDay ? e.start : e.start.slice(0, 10);
    let time: string;
    if (e.allDay) {
      time = "All day";
    } else {
      const startTime = e.start.slice(11, 16);
      const endTime = e.end ? e.end.slice(11, 16) : "";
      time = endTime ? `${startTime}-${endTime}` : startTime;
    }
    return {
      date: startDate,
      time,
      summary: e.summary || "(no title)",
      location: e.location,
      calendar: e.calendar || "",
    };
  });

  const cols: Array<{ key: keyof (typeof rows)[0]; header: string }> = [
    { key: "date", header: "Date" },
    { key: "time", header: "Time" },
    { key: "summary", header: "Summary" },
  ];
  if (hasLocation) cols.push({ key: "location", header: "Location" });
  if (hasCalendar) cols.push({ key: "calendar", header: "Calendar" });

  // Calculate widths
  const widths = cols.map((col) =>
    Math.max(col.header.length, ...rows.map((r) => (r[col.key] || "").length)),
  );

  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const sep = widths.map((w) => "─".repeat(w)).join("──");

  const lines: string[] = [];
  lines.push(cols.map((c, i) => pad(c.header, widths[i] ?? 0)).join("  "));
  lines.push(sep);
  for (const row of rows) {
    lines.push(cols.map((c, i) => pad(row[c.key] || "", widths[i] ?? 0)).join("  "));
  }

  return lines.join("\n");
}
