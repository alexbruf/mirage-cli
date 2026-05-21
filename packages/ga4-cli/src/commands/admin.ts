import { Command } from "commander";
import {
  parseJson,
  parsePositiveInt,
  resolveAccountId,
  resolvePropertyId,
  run,
  validateDateRanges,
  validateFilter,
  validateOrderBy,
} from "../utils.ts";
import { gaRequest, listAll, listAllPost, ADMIN_BETA, ADMIN_ALPHA } from "../rest.ts";

export function registerAdminCommands(program: Command): void {
  program
    .command("accounts")
    .description("List account summaries (accounts and their properties)")
    .action(async (_opts, cmd: Command) => {
      const format = cmd.optsWithGlobals().format;
      await run(
        async () => listAll(`${ADMIN_BETA}/accountSummaries`, "accountSummaries"),
        format,
      );
    });

  program
    .command("property [property_id]")
    .description("Get details about a property")
    .action(async (_propertyId, _opts, cmd: Command) => {
      const format = cmd.optsWithGlobals().format;
      const name = resolvePropertyId(cmd);
      await run(async () => gaRequest(`${ADMIN_BETA}/${name}`), format);
    });

  program
    .command("properties <account_id>")
    .description("List properties for an account")
    .option("--show-deleted", "Include deleted properties")
    .action(async (accountId: string, opts, cmd: Command) => {
      const format = cmd.optsWithGlobals().format;
      await run(async () => {
        const account = resolveAccountId(accountId);
        const query: Record<string, string | boolean> = { filter: `parent:${account}` };
        if (opts.showDeleted) query.showDeleted = true;
        return listAll(`${ADMIN_BETA}/properties`, "properties", query);
      }, format);
    });

  program
    .command("data-streams [property_id]")
    .description("List data streams for a property")
    .action(async (_propertyId, _opts, cmd: Command) => {
      const format = cmd.optsWithGlobals().format;
      const parent = resolvePropertyId(cmd);
      await run(
        async () => listAll(`${ADMIN_BETA}/${parent}/dataStreams`, "dataStreams"),
        format,
      );
    });

  program
    .command("key-events [property_id]")
    .description("List key events for a property")
    .action(async (_propertyId, _opts, cmd: Command) => {
      const format = cmd.optsWithGlobals().format;
      const parent = resolvePropertyId(cmd);
      await run(
        async () => listAll(`${ADMIN_BETA}/${parent}/keyEvents`, "keyEvents"),
        format,
      );
    });

  program
    .command("admin-custom-dimensions [property_id]")
    .description("List custom dimensions for a property (Admin API)")
    .action(async (_propertyId, _opts, cmd: Command) => {
      const format = cmd.optsWithGlobals().format;
      const parent = resolvePropertyId(cmd);
      await run(
        async () => listAll(`${ADMIN_BETA}/${parent}/customDimensions`, "customDimensions"),
        format,
      );
    });

  program
    .command("admin-custom-metrics [property_id]")
    .description("List custom metrics for a property (Admin API)")
    .action(async (_propertyId, _opts, cmd: Command) => {
      const format = cmd.optsWithGlobals().format;
      const parent = resolvePropertyId(cmd);
      await run(
        async () => listAll(`${ADMIN_BETA}/${parent}/customMetrics`, "customMetrics"),
        format,
      );
    });

  program
    .command("data-retention [property_id]")
    .description("Get data retention settings for a property")
    .action(async (_propertyId, _opts, cmd: Command) => {
      const format = cmd.optsWithGlobals().format;
      const property = resolvePropertyId(cmd);
      await run(async () => gaRequest(`${ADMIN_BETA}/${property}/dataRetentionSettings`), format);
    });

  program
    .command("ads-links [property_id]")
    .description("List Google Ads links for a property")
    .action(async (_propertyId, _opts, cmd: Command) => {
      const format = cmd.optsWithGlobals().format;
      const parent = resolvePropertyId(cmd);
      await run(
        async () => listAll(`${ADMIN_BETA}/${parent}/googleAdsLinks`, "googleAdsLinks"),
        format,
      );
    });

  program
    .command("annotations [property_id]")
    .description("List annotations for a property (alpha API)")
    .action(async (_propertyId, _opts, cmd: Command) => {
      const format = cmd.optsWithGlobals().format;
      const parent = resolvePropertyId(cmd);
      await run(
        async () =>
          listAll(
            `${ADMIN_ALPHA}/${parent}/reportingDataAnnotations`,
            "reportingDataAnnotations",
          ),
        format,
      );
    });

  program
    .command("change-history <account_id>")
    .description("Search change history events for an account")
    .option("--filter-property <id>", "Filter by property ID")
    .option("--earliest-change-time <timestamp>", "Earliest change time (RFC3339)")
    .option("--latest-change-time <timestamp>", "Latest change time (RFC3339)")
    .option("--resource-type <json>", "JSON array of resource types to filter")
    .option("--action <json>", "JSON array of action types to filter")
    .option("--actor-email <email>", "Filter by actor email")
    .action(async (accountId: string, opts, cmd: Command) => {
      const format = cmd.optsWithGlobals().format;
      await run(async () => {
        const account = resolveAccountId(accountId);
        const body: Record<string, unknown> = {};
        if (opts.filterProperty) {
          const pid = String(opts.filterProperty);
          body.property = pid.startsWith("properties/") ? pid : `properties/${pid}`;
        }
        if (opts.earliestChangeTime) body.earliestChangeTime = opts.earliestChangeTime;
        if (opts.latestChangeTime) body.latestChangeTime = opts.latestChangeTime;
        if (opts.resourceType) {
          const rt = parseJson(opts.resourceType);
          if (!Array.isArray(rt)) throw new Error("--resource-type must be a JSON array.");
          body.resourceType = rt;
        }
        if (opts.action) {
          const a = parseJson(opts.action);
          if (!Array.isArray(a)) throw new Error("--action must be a JSON array.");
          body.action = a;
        }
        if (opts.actorEmail) body.actorEmail = [opts.actorEmail];
        return listAllPost(
          `${ADMIN_BETA}/${account}:searchChangeHistoryEvents`,
          "changeHistoryEvents",
          body,
        );
      }, format);
    });

  program
    .command("access-report [property_id]")
    .description("Run an access report for a property (GA360-only)")
    .requiredOption("--dimensions <names>", "Comma-separated dimension names")
    .requiredOption("--metrics <names>", "Comma-separated metric names")
    .requiredOption("--date-ranges <json>", "JSON array of date ranges")
    .option("--dimension-filter <json>", "JSON FilterExpression for dimensions")
    .option("--metric-filter <json>", "JSON FilterExpression for metrics")
    .option("--order-by <json>", "JSON array of OrderBy objects")
    .option("--limit <n>", "Max rows to return", parsePositiveInt)
    .option("--offset <n>", "Row offset for pagination", parsePositiveInt)
    .option("--time-zone <tz>", "Time zone (e.g. America/Los_Angeles)")
    .option("--return-entity-quota", "Include entity quota in response")
    .option("--include-all-users", "Include users who have never accessed the API")
    .option("--expand-groups", "Expand group memberships")
    .action(async (_propertyId, opts, cmd: Command) => {
      const format = cmd.optsWithGlobals().format;
      const property = resolvePropertyId(cmd);
      await run(async () => {
        const dateRanges = parseJson(opts.dateRanges);
        validateDateRanges(dateRanges);
        const body: Record<string, unknown> = {
          dimensions: opts.dimensions
            .split(",")
            .map((s: string) => ({ dimensionName: s.trim() })),
          metrics: opts.metrics
            .split(",")
            .map((s: string) => ({ metricName: s.trim() })),
          dateRanges,
        };
        if (opts.dimensionFilter) {
          const f = parseJson(opts.dimensionFilter);
          validateFilter(f, "--dimension-filter");
          body.dimensionFilter = f;
        }
        if (opts.metricFilter) {
          const f = parseJson(opts.metricFilter);
          validateFilter(f, "--metric-filter");
          body.metricFilter = f;
        }
        if (opts.orderBy) {
          const o = parseJson(opts.orderBy);
          validateOrderBy(o);
          body.orderBys = o;
        }
        if (opts.limit != null) body.limit = opts.limit;
        if (opts.offset != null) body.offset = opts.offset;
        if (opts.timeZone) body.timeZone = opts.timeZone;
        if (opts.returnEntityQuota) body.returnEntityQuota = true;
        if (opts.includeAllUsers) body.includeAllUsers = true;
        if (opts.expandGroups) body.expandGroups = true;

        return gaRequest(`${ADMIN_ALPHA}/${property}:runAccessReport`, {
          method: "POST",
          body,
        });
      }, format);
    });
}
