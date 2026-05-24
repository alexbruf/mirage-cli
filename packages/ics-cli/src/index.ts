/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/ics`, plus the parser and formatter helpers.
 */
export { buildProgram } from "./cli.ts";
export { fetchIcs, parseEvents } from "./calendar.ts";
export { formatJson, formatTable } from "./formatter.ts";
export {
  addCalendar,
  removeCalendar,
  getCalendar,
  listCalendars,
  getAllCalendarUrls,
} from "./config.ts";
export type { CalendarEvent, CalendarEntry, Config } from "./types.ts";
