import ICAL from "ical.js";
import { readFileSync } from "fs";
import type { CalendarEvent } from "./types.ts";

export async function fetchIcs(source: string): Promise<string> {
  // Convert webcal:// to https://
  if (source.startsWith("webcal://")) {
    source = "https://" + source.slice("webcal://".length);
  }

  if (source.startsWith("http://") || source.startsWith("https://")) {
    const resp = await fetch(source);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    return resp.text();
  }

  return readFileSync(source, "utf-8");
}

function icalTimeToISO(time: ICAL.Time): string {
  return time.toJSDate().toISOString();
}

function isAllDay(time: ICAL.Time): boolean {
  return time.isDate;
}

function formatDateOnly(time: ICAL.Time): string {
  const d = time.toJSDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseEvents(
  icsText: string,
  start: Date | null,
  end: Date | null,
  calendarName: string | null,
): CalendarEvent[] {
  const jcalData = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcalData);
  const vevents = comp.getAllSubcomponents("vevent");

  const rangeStart = start ? ICAL.Time.fromJSDate(start, false) : null;
  const rangeEnd = end ? ICAL.Time.fromJSDate(end, false) : null;

  const results: CalendarEvent[] = [];

  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent);
    const dtstart = event.startDate;

    if (!dtstart) continue;

    // Handle recurring events
    if (event.isRecurring()) {
      const iterator = event.iterator();
      let next: ICAL.Time | null;
      let count = 0;
      const maxOccurrences = 1000; // safety limit

      while ((next = iterator.next()) && count < maxOccurrences) {
        count++;

        if (rangeEnd && next.compare(rangeEnd) > 0) break;
        if (rangeStart && next.compare(rangeStart) < 0) continue;

        const duration = event.duration;
        const endTime = next.clone();
        if (duration) endTime.addDuration(duration);

        const allDay = isAllDay(next);

        results.push({
          summary: event.summary || "",
          start: allDay ? formatDateOnly(next) : icalTimeToISO(next),
          end: allDay ? formatDateOnly(endTime) : icalTimeToISO(endTime),
          location: event.location || "",
          description: event.description || "",
          uid: event.uid || "",
          allDay,
          calendar: calendarName,
        });
      }
    } else {
      // Non-recurring event
      if (rangeStart && dtstart.compare(rangeStart) < 0) {
        // Check if event ends after range start (multi-day events)
        const dtend = event.endDate;
        if (!dtend || dtend.compare(rangeStart) <= 0) continue;
      }
      if (rangeEnd && dtstart.compare(rangeEnd) >= 0) continue;

      const allDay = isAllDay(dtstart);
      const dtend = event.endDate;

      results.push({
        summary: event.summary || "",
        start: allDay ? formatDateOnly(dtstart) : icalTimeToISO(dtstart),
        end: dtend ? (allDay ? formatDateOnly(dtend) : icalTimeToISO(dtend)) : null,
        location: event.location || "",
        description: event.description || "",
        uid: event.uid || "",
        allDay,
        calendar: calendarName,
      });
    }
  }

  // Sort by start time
  results.sort((a, b) => a.start.localeCompare(b.start));
  return results;
}
