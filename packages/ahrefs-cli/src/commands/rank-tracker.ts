import { endpointCommand } from "../command-builder.ts";
import { group } from "../framework/runtime.ts";

export const rankTrackerOverviewCmd = endpointCommand({
  path: "/rank-tracker/overview",
  name: "overview",
  rowsKey: "keywords",
});

export const rankTrackerSerpOverviewCmd = endpointCommand({
  path: "/rank-tracker/serp-overview",
  name: "serp-overview",
  rowsKey: "positions",
});

export const rankTrackerCompetitorsOverviewCmd = endpointCommand({
  path: "/rank-tracker/competitors-overview",
  name: "competitors-overview",
  rowsKey: "competitors",
});

export const rankTrackerCompetitorsPagesCmd = endpointCommand({
  path: "/rank-tracker/competitors-pages",
  name: "competitors-pages",
  rowsKey: "pages",
});

export const rankTrackerCompetitorsStatsCmd = endpointCommand({
  path: "/rank-tracker/competitors-stats",
  name: "competitors-stats",
  rowsKey: "competitors",
});

export const rankTrackerGroup = group({
  name: "rank-tracker",
  description: "Rank Tracker — keyword rankings and competitor positions.",
  commands: [
    rankTrackerOverviewCmd,
    rankTrackerSerpOverviewCmd,
    rankTrackerCompetitorsOverviewCmd,
    rankTrackerCompetitorsPagesCmd,
    rankTrackerCompetitorsStatsCmd,
  ],
});
