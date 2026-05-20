import { endpointCommand } from "../command-builder.ts";
import { group } from "../framework/runtime.ts";

export const gscKeywordsCmd = endpointCommand({
  path: "/gsc/keywords",
  name: "keywords",
  rowsKey: "keywords",
});

export const gscPagesCmd = endpointCommand({
  path: "/gsc/pages",
  name: "pages",
  rowsKey: "pages",
});

export const gscAnonymousQueriesCmd = endpointCommand({
  path: "/gsc/anonymous-queries",
  name: "anonymous-queries",
  rowsKey: "queries",
});

export const gscPerformanceHistoryCmd = endpointCommand({
  path: "/gsc/performance-history",
  name: "performance-history",
  rowsKey: "metrics",
});

export const gscPerformanceByDeviceCmd = endpointCommand({
  path: "/gsc/performance-by-device",
  name: "performance-by-device",
  rowsKey: "metrics",
});

export const gscPerformanceByPositionCmd = endpointCommand({
  path: "/gsc/performance-by-position",
  name: "performance-by-position",
  rowsKey: "metrics",
});

export const gscPositionsHistoryCmd = endpointCommand({
  path: "/gsc/positions-history",
  name: "positions-history",
  rowsKey: "metrics",
});

export const gscPagesHistoryCmd = endpointCommand({
  path: "/gsc/pages-history",
  name: "pages-history",
  rowsKey: "metrics",
});

export const gscPageHistoryCmd = endpointCommand({
  path: "/gsc/page-history",
  name: "page-history",
  rowsKey: "metrics",
});

export const gscKeywordHistoryCmd = endpointCommand({
  path: "/gsc/keyword-history",
  name: "keyword-history",
  rowsKey: "metrics",
});

export const gscMetricsByCountryCmd = endpointCommand({
  path: "/gsc/metrics-by-country",
  name: "metrics-by-country",
  rowsKey: "metrics",
});

export const gscCtrByPositionCmd = endpointCommand({
  path: "/gsc/ctr-by-position",
  name: "ctr-by-position",
  rowsKey: "ctr",
});

export const gscGroup = group({
  name: "gsc",
  description: "Google Search Console reports via Ahrefs (requires integration).",
  commands: [
    gscKeywordsCmd,
    gscPagesCmd,
    gscAnonymousQueriesCmd,
    gscPerformanceHistoryCmd,
    gscPerformanceByDeviceCmd,
    gscPerformanceByPositionCmd,
    gscPositionsHistoryCmd,
    gscPagesHistoryCmd,
    gscPageHistoryCmd,
    gscKeywordHistoryCmd,
    gscMetricsByCountryCmd,
    gscCtrByPositionCmd,
  ],
});
