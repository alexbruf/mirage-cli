import { endpointCommand } from "../command-builder.ts";
import { group } from "../framework/runtime.ts";

const T = "target" as const;

// Overview tab
export const siteExplorerOverviewCmd = endpointCommand({
  path: "/site-explorer/metrics",
  name: "overview",
  summary: "Snapshot SEO metrics for a target (overview tab in the web UI).",
  defaultSelect:
    "org_keywords,paid_keywords,org_traffic,paid_traffic,org_cost,paid_cost,paid_pages",
  single: true,
  rowsKey: "metrics",
  positional: T,
});

export const siteExplorerDomainRatingCmd = endpointCommand({
  path: "/site-explorer/domain-rating",
  name: "domain-rating",
  single: true,
  rowsKey: "domain_rating",
  positional: T,
});

export const siteExplorerUrlRatingHistoryCmd = endpointCommand({
  path: "/site-explorer/url-rating-history",
  name: "url-rating-history",
  rowsKey: "metrics",
  positional: T,
});

export const siteExplorerDomainRatingHistoryCmd = endpointCommand({
  path: "/site-explorer/domain-rating-history",
  name: "domain-rating-history",
  rowsKey: "domain_rating",
  positional: T,
});

export const siteExplorerMetricsHistoryCmd = endpointCommand({
  path: "/site-explorer/metrics-history",
  name: "metrics-history",
  rowsKey: "metrics",
  positional: T,
});

export const siteExplorerMetricsByCountryCmd = endpointCommand({
  path: "/site-explorer/metrics-by-country",
  name: "metrics-by-country",
  rowsKey: "metrics",
  positional: T,
});

// Backlinks tab
export const siteExplorerBacklinksCmd = endpointCommand({
  path: "/site-explorer/all-backlinks",
  name: "backlinks",
  defaultSelect:
    "url_from,url_to,anchor,domain_rating_source,is_dofollow,first_seen",
  rowsKey: "backlinks",
  positional: T,
});

export const siteExplorerBrokenBacklinksCmd = endpointCommand({
  path: "/site-explorer/broken-backlinks",
  name: "broken-backlinks",
  defaultSelect:
    "url_from,url_to,anchor,domain_rating_source,http_code,first_seen",
  rowsKey: "backlinks",
  positional: T,
});

export const siteExplorerBacklinksStatsCmd = endpointCommand({
  path: "/site-explorer/backlinks-stats",
  name: "backlinks-stats",
  single: true,
  positional: T,
});

export const siteExplorerRefdomainsCmd = endpointCommand({
  path: "/site-explorer/refdomains",
  name: "refdomains",
  defaultSelect:
    "domain,domain_rating,dofollow_refdomains,dofollow_links,first_seen,last_seen",
  rowsKey: "refdomains",
  positional: T,
});

export const siteExplorerRefdomainsHistoryCmd = endpointCommand({
  path: "/site-explorer/refdomains-history",
  name: "refdomains-history",
  rowsKey: "refdomains",
  positional: T,
});

export const siteExplorerAnchorsCmd = endpointCommand({
  path: "/site-explorer/anchors",
  name: "anchors",
  defaultSelect: "anchor,refdomains,refpages,dofollow_links",
  rowsKey: "anchors",
  positional: T,
});

export const siteExplorerLinkedAnchorsExternalCmd = endpointCommand({
  path: "/site-explorer/linked-anchors-external",
  name: "linked-anchors-external",
  rowsKey: "anchors",
  positional: T,
});

export const siteExplorerLinkedAnchorsInternalCmd = endpointCommand({
  path: "/site-explorer/linked-anchors-internal",
  name: "linked-anchors-internal",
  rowsKey: "anchors",
  positional: T,
});

export const siteExplorerLinkeddomainsCmd = endpointCommand({
  path: "/site-explorer/linkeddomains",
  name: "linkeddomains",
  rowsKey: "linkeddomains",
  positional: T,
});

export const siteExplorerOutlinksStatsCmd = endpointCommand({
  path: "/site-explorer/outlinks-stats",
  name: "outlinks-stats",
  single: true,
  positional: T,
});

// Organic search tab
export const siteExplorerOrganicKeywordsCmd = endpointCommand({
  path: "/site-explorer/organic-keywords",
  name: "organic-keywords",
  defaultSelect: "keyword,best_position,volume,cpc,best_position_url",
  rowsKey: "keywords",
  positional: T,
});

export const siteExplorerOrganicCompetitorsCmd = endpointCommand({
  path: "/site-explorer/organic-competitors",
  name: "organic-competitors",
  defaultSelect: "competitor_domain,keywords_common,traffic,value",
  rowsKey: "competitors",
  positional: T,
});

export const siteExplorerKeywordsHistoryCmd = endpointCommand({
  path: "/site-explorer/keywords-history",
  name: "keywords-history",
  rowsKey: "metrics",
  positional: T,
});

export const siteExplorerTotalSearchVolumeHistoryCmd = endpointCommand({
  path: "/site-explorer/total-search-volume-history",
  name: "total-search-volume-history",
  rowsKey: "metrics",
  positional: T,
});

// Pages tab
export const siteExplorerTopPagesCmd = endpointCommand({
  path: "/site-explorer/top-pages",
  name: "top-pages",
  defaultSelect: "url,sum_traffic,value,top_keyword,top_keyword_volume",
  rowsKey: "pages",
  positional: T,
});

export const siteExplorerPagesByTrafficCmd = endpointCommand({
  path: "/site-explorer/pages-by-traffic",
  name: "pages-by-traffic",
  rowsKey: "pages",
  positional: T,
});

export const siteExplorerPagesByBacklinksCmd = endpointCommand({
  path: "/site-explorer/pages-by-backlinks",
  name: "pages-by-backlinks",
  rowsKey: "pages",
  positional: T,
});

export const siteExplorerPagesByInternalLinksCmd = endpointCommand({
  path: "/site-explorer/pages-by-internal-links",
  name: "pages-by-internal-links",
  rowsKey: "pages",
  positional: T,
});

export const siteExplorerPagesHistoryCmd = endpointCommand({
  path: "/site-explorer/pages-history",
  name: "pages-history",
  rowsKey: "pages",
  positional: T,
});

export const siteExplorerPaidPagesCmd = endpointCommand({
  path: "/site-explorer/paid-pages",
  name: "paid-pages",
  rowsKey: "pages",
  positional: T,
});

export const siteExplorerCrawledPagesCmd = endpointCommand({
  path: "/site-explorer/crawled-pages",
  name: "crawled-pages",
  rowsKey: "pages",
  positional: T,
});

export const siteExplorerGroup = group({
  name: "site-explorer",
  description: "Site Explorer — metrics, backlinks, keywords, pages.",
  commands: [
    siteExplorerOverviewCmd,
    siteExplorerDomainRatingCmd,
    siteExplorerUrlRatingHistoryCmd,
    siteExplorerDomainRatingHistoryCmd,
    siteExplorerMetricsHistoryCmd,
    siteExplorerMetricsByCountryCmd,
    siteExplorerBacklinksCmd,
    siteExplorerBrokenBacklinksCmd,
    siteExplorerBacklinksStatsCmd,
    siteExplorerRefdomainsCmd,
    siteExplorerRefdomainsHistoryCmd,
    siteExplorerAnchorsCmd,
    siteExplorerLinkedAnchorsExternalCmd,
    siteExplorerLinkedAnchorsInternalCmd,
    siteExplorerLinkeddomainsCmd,
    siteExplorerOutlinksStatsCmd,
    siteExplorerOrganicKeywordsCmd,
    siteExplorerOrganicCompetitorsCmd,
    siteExplorerKeywordsHistoryCmd,
    siteExplorerTotalSearchVolumeHistoryCmd,
    siteExplorerTopPagesCmd,
    siteExplorerPagesByTrafficCmd,
    siteExplorerPagesByBacklinksCmd,
    siteExplorerPagesByInternalLinksCmd,
    siteExplorerPagesHistoryCmd,
    siteExplorerPaidPagesCmd,
    siteExplorerCrawledPagesCmd,
  ],
});
