/**
 * ics-cli as a commander.js program factory. No side effects on import:
 * `buildProgram()` returns a fresh `Command` instance; the CLI entry point
 * `src/bin.ts` calls `.parseAsync(process.argv)` separately.
 *
 * - `today` / `week` / `next` / `events`: read-only fetches from saved
 *   calendar URLs or ad-hoc `--url`.
 * - `add` / `remove` / `list`: manage the local config at
 *   `~/.config/ics-cli/config.json`. (Mutating, but local only.)
 */
import { Command } from "commander";
import {
  addCalendar,
  getAllCalendarUrls,
  getCalendar,
  listCalendars,
  removeCalendar,
} from "./config.ts";
import { fetchIcs, parseEvents } from "./calendar.ts";
import { formatJson, formatTable } from "./formatter.ts";
import type { CalendarEvent } from "./types.ts";

interface SourceOpts {
  calendar?: string;
  url?: string;
  json?: boolean;
  from?: string;
  to?: string;
  limit?: number;
}

function resolveSource(
  calendar: string | undefined,
  url: string | undefined,
): Array<[string | null, string]> {
  if (url) return [[null, url]];
  if (calendar) {
    const cal = getCalendar(calendar);
    if (!cal) {
      throw new Error(`Calendar '${calendar}' not found. Use 'ics-cli list' to see saved calendars.`);
    }
    return [[cal.name, cal.url]];
  }
  const all = getAllCalendarUrls();
  if (all.length === 0) {
    throw new Error("No calendars configured. Use 'ics-cli add <name> <url>' or pass --url.");
  }
  return all;
}

async function fetchAndDisplay(opts: {
  calendar?: string;
  url?: string;
  from?: Date | null;
  to?: Date | null;
  json?: boolean;
  limit?: number;
}): Promise<void> {
  const sources = resolveSource(opts.calendar, opts.url);
  const allEvents: CalendarEvent[] = [];

  for (const [name, sourceUrl] of sources) {
    try {
      const icsText = await fetchIcs(sourceUrl);
      const events = parseEvents(icsText, opts.from ?? null, opts.to ?? null, name);
      allEvents.push(...events);
    } catch (e: any) {
      process.stderr.write(`Error fetching '${name || sourceUrl}': ${e.message}\n`);
    }
  }

  allEvents.sort((a, b) => a.start.localeCompare(b.start));

  if (opts.limit) {
    allEvents.splice(opts.limit);
  }

  if (allEvents.length === 0) {
    process.stdout.write(opts.json ? "[]\n" : "No events found.\n");
    return;
  }

  process.stdout.write((opts.json ? formatJson(allEvents) : formatTable(allEvents)) + "\n");
}

function parseDate(s: string): Date {
  const d = new Date(s + "T00:00:00");
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${s}. Use YYYY-MM-DD format.`);
  }
  return d;
}

function attachSourceOpts(cmd: Command): Command {
  return cmd
    .option("-c, --calendar <name>", "saved calendar name")
    .option("-u, --url <url>", "ICS URL or file path")
    .option("--json", "output as JSON");
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("ics-cli")
    .description("Read and query ICS calendar files")
    .version("0.1.6");

  program
    .command("add")
    .description("Save a calendar URL with a name")
    .argument("<name>", "Calendar name")
    .argument("<url>", "ICS URL or file path")
    .action((name: string, url: string) => {
      addCalendar(name, url);
      process.stdout.write(`Added calendar '${name}'\n`);
    });

  program
    .command("list")
    .description("List saved calendars")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const cals = listCalendars();
      if (opts.json) {
        process.stdout.write(JSON.stringify(cals, null, 2) + "\n");
      } else if (cals.length === 0) {
        process.stdout.write("No calendars saved. Use 'ics-cli add <name> <url>' to add one.\n");
      } else {
        for (const cal of cals) {
          process.stdout.write(`  ${cal.name}: ${cal.url}\n`);
        }
      }
    });

  program
    .command("remove")
    .description("Remove a saved calendar")
    .argument("<name>", "Calendar name")
    .action((name: string) => {
      if (removeCalendar(name)) {
        process.stdout.write(`Removed calendar '${name}'\n`);
      } else {
        throw new Error(`Calendar '${name}' not found`);
      }
    });

  const events = program
    .command("events")
    .description("Fetch and display calendar events")
    .option("--from <date>", "Start date (YYYY-MM-DD)")
    .option("--to <date>", "End date (YYYY-MM-DD)")
    .option("-n, --limit <n>", "Max events to show", parseInt);
  attachSourceOpts(events);
  events.action(async (opts: SourceOpts) => {
    await fetchAndDisplay({
      calendar: opts.calendar,
      url: opts.url,
      from: opts.from ? parseDate(opts.from) : null,
      to: opts.to ? parseDate(opts.to) : null,
      json: opts.json,
      limit: opts.limit,
    });
  });

  const today = program.command("today").description("Show today's events");
  attachSourceOpts(today);
  today.action(async (opts: SourceOpts) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 86400000);
    await fetchAndDisplay({ calendar: opts.calendar, url: opts.url, from: start, to: end, json: opts.json });
  });

  const week = program.command("week").description("Show this week's events (Mon-Sun)");
  attachSourceOpts(week);
  week.action(async (opts: SourceOpts) => {
    const now = new Date();
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
    const sunday = new Date(monday.getTime() + 7 * 86400000);
    await fetchAndDisplay({ calendar: opts.calendar, url: opts.url, from: monday, to: sunday, json: opts.json });
  });

  const next = program
    .command("next")
    .description("Show next N upcoming events")
    .option("-n, --limit <n>", "Number of upcoming events", parseInt, 5);
  attachSourceOpts(next);
  next.action(async (opts: SourceOpts) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 365 * 86400000);
    await fetchAndDisplay({
      calendar: opts.calendar,
      url: opts.url,
      from: start,
      to: end,
      json: opts.json,
      limit: opts.limit,
    });
  });

  return program;
}
