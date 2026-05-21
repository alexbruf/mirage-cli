import type {
  ClarityFilters, DeviceType, Browser, OS, Channel, UserType, UrlFilter,
} from "./types.ts";

export interface SessionFlags {
  days?: number;
  from?: string;
  to?: string;
  urlContains?: string;
  entryUrl?: string;
  exitUrl?: string;
  device?: string[];
  browser?: string[];
  os?: string[];
  country?: string[];
  city?: string[];
  userType?: string;
  intent?: string;
  channel?: string[];
  source?: string[];
  medium?: string[];
  campaign?: string[];
  smartEvent?: string[];
  rageClicks?: boolean;
  deadClicks?: boolean;
  quickbackClicks?: boolean;
  excessiveScroll?: boolean;
  jsErrors?: boolean;
  clickErrors?: boolean;
  minDuration?: number;  // seconds
  maxDuration?: number;
  minScroll?: number;    // percent
  maxScroll?: number;
  clickedText?: string;
  productName?: string;
  productPurchases?: boolean;
}

function isoStart(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString();
}
function isoEnd(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();
}

function dateRange(f: SessionFlags): { start: string; end: string } {
  const now = new Date();
  if (f.from || f.to) {
    const start = f.from ? isoStart(new Date(f.from + "T00:00:00")) : isoStart(new Date(now.getTime() - 7 * 86400000));
    const end = f.to ? isoEnd(new Date(f.to + "T00:00:00")) : now.toISOString();
    return { start, end };
  }
  const days = f.days ?? 3;
  const start = new Date(now.getTime() - days * 86400000);
  return { start: start.toISOString(), end: now.toISOString() };
}

function urlFilters(value: string | undefined, operator: UrlFilter["operator"] = "contains"): UrlFilter[] | undefined {
  if (!value) return undefined;
  return [{ url: value, operator }];
}

const USER_TYPE_MAP: Record<string, UserType> = {
  new: "NewUser", NewUser: "NewUser",
  returning: "ReturningUser", ReturningUser: "ReturningUser",
};

const INTENT_MAP: Record<string, ClarityFilters["sessionIntent"]> = {
  low: "Low Intention", Low: "Low Intention", "Low Intention": "Low Intention",
  medium: "Medium Intention", Medium: "Medium Intention", "Medium Intention": "Medium Intention",
  high: "High Intention", High: "High Intention", "High Intention": "High Intention",
};

function minutes(seconds: number | undefined): number | null {
  if (seconds === undefined) return null;
  return seconds / 60;
}

export function buildFilters(f: SessionFlags): ClarityFilters {
  const filters: ClarityFilters = { date: dateRange(f) };

  if (f.urlContains) filters.visitedUrls = urlFilters(f.urlContains);
  if (f.entryUrl)    filters.entryUrls   = urlFilters(f.entryUrl);
  if (f.exitUrl)     filters.exitUrls    = urlFilters(f.exitUrl);

  if (f.device?.length)  filters.deviceType = f.device as DeviceType[];
  if (f.browser?.length) filters.browser    = f.browser as Browser[];
  if (f.os?.length)      filters.os         = f.os as OS[];
  if (f.country?.length) filters.country    = f.country;
  if (f.city?.length)    filters.city       = f.city;
  if (f.channel?.length) filters.channel    = f.channel as Channel[];
  if (f.source?.length)  filters.source     = f.source;
  if (f.medium?.length)  filters.medium     = f.medium;
  if (f.campaign?.length) filters.campaign  = f.campaign;
  if (f.smartEvent?.length) filters.smartEvents = f.smartEvent;

  if (f.userType) filters.userType = USER_TYPE_MAP[f.userType] ?? (f.userType as UserType);
  if (f.intent)   filters.sessionIntent = INTENT_MAP[f.intent];

  if (f.rageClicks)       filters.rageClickPresent = true;
  if (f.deadClicks)       filters.deadClickPresent = true;
  if (f.quickbackClicks)  filters.quickbackClickPresent = true;
  if (f.excessiveScroll)  filters.excessiveScrollPresent = true;
  if (f.jsErrors)         filters.javascriptErrors = [""];
  if (f.clickErrors)      filters.clickErrors = [""];

  if (f.minDuration !== undefined || f.maxDuration !== undefined) {
    filters.sessionDuration = { min: minutes(f.minDuration), max: minutes(f.maxDuration) };
  }
  if (f.minScroll !== undefined || f.maxScroll !== undefined) {
    filters.scrollDepth = { min: f.minScroll ?? null, max: f.maxScroll ?? null };
  }
  if (f.clickedText)   filters.clickedText = f.clickedText;
  if (f.productName)   filters.productName = f.productName;
  if (f.productPurchases) filters.productPurchases = true;

  return filters;
}
