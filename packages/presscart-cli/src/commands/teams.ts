import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import { type OutputOpts, unwrapList, writeOutput } from "../output.ts";

function client(): ApiClient {
  return new ApiClient(requireSession());
}

/**
 * List the teams the current token can see (GET /teams). The team-scoped
 * publishing endpoints (`/teams/:slug/...`) need the team `slug`, but the token
 * only reveals `team_id` via `whoami`. Use this to map that id → slug:
 *   presscart teams list --format json
 */
export async function listTeams(opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>("/teams");
  writeOutput(unwrapList(res, ["teams"]), opts);
}
