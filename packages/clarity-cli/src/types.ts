// Shared types mirroring the Microsoft Clarity MCP server's Zod schema.
// Kept as plain TS unions so we don't ship zod in the bundled skill fallback.

export type DeviceType = "Mobile" | "Tablet" | "PC" | "Email" | "Other";

export type Browser =
  | "Bot" | "MiuiBrowser" | "Chrome" | "CoralWebView" | "Edge" | "Other"
  | "Firefox" | "IE" | "Unknown" | "Headless" | "MobileApp" | "Opera"
  | "OperaMini" | "Safari" | "Samsung" | "SamsungInternet" | "Sogou"
  | "UCBrowser" | "YandexBrowser" | "QQBrowser";

export type OS =
  | "BlackBerry" | "Android" | "ChromeOS" | "iOS" | "Linux" | "MacOS"
  | "Other" | "Windows" | "WindowsMobile";

export type Channel =
  | "OrganicSearch" | "Direct" | "Email" | "Display" | "Social"
  | "PaidSearch" | "Other" | "Affiliate" | "Referral" | "Video"
  | "Audio" | "SMS" | "AITools" | "PaidAITools";

export type UserType = "NewUser" | "ReturningUser";

export type Intent = "Low Intention" | "Medium Intention" | "High Intention";

export type SortBy =
  | "SessionStart_DESC" | "SessionStart_ASC"
  | "SessionDuration_ASC" | "SessionDuration_DESC"
  | "SessionClickCount_ASC" | "SessionClickCount_DESC"
  | "PageCount_ASC" | "PageCount_DESC";

export type UrlOperator =
  | "contains" | "startsWith" | "endsWith" | "excludes"
  | "isExactly" | "isExactlyNot" | "matchesRegex" | "excludesRegex";

export interface UrlFilter {
  url: string;
  operator: UrlOperator;
}

export interface RangeFilter {
  min: number | null;
  max: number | null;
}

// Mirrors the MCP server's FiltersType. Every field is optional except `date`.
export interface ClarityFilters {
  referringUrl?: string;
  userType?: UserType;
  sessionIntent?: Intent;
  visitedUrls?: UrlFilter[];
  entryUrls?: UrlFilter[];
  exitUrls?: UrlFilter[];
  country?: string[];
  city?: string[];
  state?: string[];
  deviceType?: DeviceType[];
  browser?: Browser[];
  os?: OS[];
  source?: string[];
  medium?: string[];
  campaign?: string[];
  channel?: Channel[];
  smartEvents?: string[];
  javascriptErrors?: string[];
  clickErrors?: string[];
  clickedText?: string;
  enteredTextPresent?: boolean;
  selectedTextPresent?: boolean;
  resizeEventPresent?: boolean;
  cursorMovement?: boolean;
  deadClickPresent?: boolean;
  rageClickPresent?: boolean;
  excessiveScrollPresent?: boolean;
  quickbackClickPresent?: boolean;
  visiblePageDuration?: RangeFilter;
  hiddenPageDuration?: RangeFilter;
  pageDuration?: RangeFilter;
  sessionDuration?: RangeFilter;
  scrollDepth?: RangeFilter;
  pagesCount?: RangeFilter;
  pageClickEventCount?: RangeFilter;
  sessionClickEventCount?: RangeFilter;
  performanceScore?: RangeFilter;
  largestContentfulPaint?: RangeFilter;
  cumulativeLayoutShift?: RangeFilter;
  firstInputDelay?: RangeFilter;
  productRating?: RangeFilter;
  productRatingsCount?: RangeFilter;
  productPrice?: RangeFilter;
  productName?: string;
  productPurchases?: boolean;
  productAvailability?: boolean;
  productBrand?: string[];
  checkoutAbandonmentStep?: string[];
  date: { start: string; end: string };
}

export type InsightsDimension =
  | "Browser" | "Device" | "Country/Region" | "OS"
  | "Source" | "Medium" | "Campaign" | "Channel" | "URL";

export interface Config {
  token?: string;
}
