/**
 * Library entrypoint. Exposes `buildProgram()` for in-process wrappers like
 * `@mirage-cli/reddit`, plus the typed API client functions and types.
 */
export { buildProgram } from "./cli.ts";
export * as api from "./client.ts";
export type {
  ApiClientOpts,
  ListingOpts,
  SearchOpts,
  SortListing,
  TimeFilter,
  CommentSort,
  SearchSort,
  SearchType,
  JobState,
  BulkItem,
} from "./client.ts";
export type {
  Post,
  Comment,
  More,
  Subreddit,
  User,
  PostListing,
  CommentChild,
  CommentListing,
  ThreadResponse,
  Listing,
  Thing,
} from "./reddit-types.ts";
