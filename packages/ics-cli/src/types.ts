export interface CalendarEvent {
  summary: string;
  start: string; // ISO 8601
  end: string | null;
  location: string;
  description: string;
  uid: string;
  allDay: boolean;
  calendar: string | null;
}

export interface CalendarEntry {
  url: string;
  added: string;
}

export interface Config {
  calendars: Record<string, CalendarEntry>;
}
