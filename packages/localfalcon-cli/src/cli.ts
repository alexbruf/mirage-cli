/**
 * localfalcon CLI as a commander.js program. `buildProgram()` has no side
 * effects on import (no top-level `.parseAsync()`). Every command is fetch-only
 * (Local Falcon REST), so the whole program is workerd-safe; the missing-key
 * path throws rather than calling `process.exit`, so it surfaces cleanly
 * through in-process runners.
 *
 * The data layer is pluggable (`src/sources/`): the Local Falcon HTTP backend
 * implements `DataSource` today.
 *
 * Read/write boundary: every command reads existing data EXCEPT `scan`, which
 * runs a new grid scan and consumes Local Falcon scan credits (billable). Wrap
 * `scan` behind a write gate in any read-only deployment.
 */
import { Command } from "commander";
import { LocalFalconSource } from "./sources/localfalcon.ts";
import type { DataSource, Row } from "./sources/types.ts";
import { render, type Format } from "./format.ts";

const VERSION = "0.1.0";

function getSource(): DataSource {
  const apiKey = process.env.LOCALFALCON_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing LOCALFALCON_API_KEY. Set it in your environment (Local Falcon: " +
        "Settings > API, https://www.localfalcon.com/).",
    );
  }
  return new LocalFalconSource(apiKey);
}

function fmt(cmd: Command): Command {
  return cmd.option("-f, --format <fmt>", "table | json | csv", "table");
}

function out(rows: Row[], format: string): void {
  console.log(render(rows, format as Format));
}

/**
 * Build a fresh, fully-configured `localfalcon` Commander program. No side
 * effects on import — the caller decides when to `.parseAsync()`.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("localfalcon")
    .description(
      "Local Falcon geo-grid rank tracking: locations, scan reports (ARP/ATRP/SoLV + map images), and new scans.",
    )
    .version(VERSION);

  fmt(
    program
      .command("locations")
      .description("List connected/saved locations (place_id, name, address, rating, reviews)")
      .option("-q, --query <text>", "filter by name/address")
      .option("-n, --limit <n>", "max rows"),
  ).action(async (o: any) => {
    out(await getSource().locations({ query: o.query, limit: num(o.limit) }), o.format);
  });

  fmt(
    program
      .command("reports")
      .description("List existing scan reports (report_key, keyword, ARP/ATRP/SoLV, image URL, date)")
      .option("-p, --place-id <id>", "filter by location place id")
      .option("-k, --keyword <kw>", "filter by keyword")
      .option("-g, --grid-size <n>", "filter by grid size")
      .option("-s, --start-date <YYYY-MM-DD>", "earliest report date")
      .option("-u, --end-date <YYYY-MM-DD>", "latest report date")
      .option("--platform <name>", "google (default) or a supported AI platform")
      .option("-n, --limit <n>", "max rows"),
  ).action(async (o: any) => {
    out(
      await getSource().reports({
        placeId: o.placeId,
        keyword: o.keyword,
        gridSize: o.gridSize,
        startDate: o.startDate,
        endDate: o.endDate,
        platform: o.platform,
        limit: num(o.limit),
      }),
      o.format,
    );
  });

  fmt(
    program
      .command("report <report_key>")
      .description("Get one scan report: ARP/ATRP/SoLV + image/heatmap/pdf URLs + grid data points"),
  ).action(async (reportKey: string, o: any) => {
    out([await getSource().report(reportKey)], o.format);
  });

  fmt(
    program
      .command("keywords")
      .description("Keyword-level rollups across locations (avg ARP/ATRP/SoLV, scan counts)")
      .option("-k, --keyword <kw>", "filter by keyword")
      .option("-s, --start-date <YYYY-MM-DD>", "earliest date")
      .option("-u, --end-date <YYYY-MM-DD>", "latest date")
      .option("-n, --limit <n>", "max rows"),
  ).action(async (o: any) => {
    out(
      await getSource().keywords({
        keyword: o.keyword,
        startDate: o.startDate,
        endDate: o.endDate,
        limit: num(o.limit),
      }),
      o.format,
    );
  });

  fmt(
    program
      .command("scan")
      .description("Run a NEW grid scan. BILLABLE: consumes Local Falcon scan credits.")
      .requiredOption("-k, --keyword <kw>", "search term to scan for")
      .option("-p, --place-id <id>", "saved location place id (or use --lat/--lng)")
      .option("--lat <deg>", "grid center latitude (with --lng)")
      .option("--lng <deg>", "grid center longitude (with --lat)")
      .option("-g, --grid-size <n>", "grid dimension, e.g. 7 for 7x7")
      .option("-r, --radius <mi>", "miles between grid points")
      .option("--platform <name>", "google (default) or a supported AI platform"),
  ).action(async (o: any) => {
    if (!o.placeId && !(o.lat && o.lng)) {
      throw new Error("Provide --place-id, or both --lat and --lng, to anchor the scan.");
    }
    out(
      [
        await getSource().runScan({
          placeId: o.placeId,
          lat: num(o.lat),
          lng: num(o.lng),
          keyword: o.keyword,
          gridSize: o.gridSize,
          radius: o.radius,
          platform: o.platform,
        }),
      ],
      o.format,
    );
  });

  program.addHelpText(
    "after",
    `
Examples:
  localfalcon locations -q "roofing"                 find a saved location
  localfalcon reports -k "roof inspection near me" -n 5
  localfalcon report <report_key> -f json            full ARP/ATRP/SoLV + image URL
  localfalcon keywords -k "metal roofing"
  localfalcon scan -k "roof inspection near me" -p <place_id> -g 7 -r 2.5   (billable)

Auth: set LOCALFALCON_API_KEY (Local Falcon > Settings > API).
`,
  );

  return program;
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
